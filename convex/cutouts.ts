import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireOwner, requireProject } from './lib/auth';
import { hasUltraPlan, requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { readProject } from './lib/project_data';
import { commitTimeline, currentTimeline } from './lib/timeline';
import { editingWorkflowActive } from './lib/assistant_workflow';
import { enqueueMediaTask } from './mediaTasks';
import { sourceEndOf } from '../lib/editor/playback-rate';
import { applyCutoutEffect, CUTOUT_EFFECT_INFO, validateCutoutEffect, type CutoutEffect } from '../lib/editor/cutout-effects';
import { cutoutEffectValidator } from './lib/cutout_effect_validator';

// fal.ai bills per frame (Oct 2026): person matting $0.0225 per 30 frames with edge refinement,
// SAM 3 object masks $0.005 per 16 frames. The worker sends at most the project's frame rate.
const USD_PER_FRAME = { person: 0.0225 / 30, object: 0.005 / 16 }, HANDLE_SECONDS = 0.25, MAX_SECONDS = 120, MAX_SUBJECT_LENGTH = 60;
const PLACEMENT_DELAY_MS = 10_000, PLACEMENT_ATTEMPTS = 360;
export const CUTOUT_PLAN_ERROR = 'Background removal is part of the Ultra plan.';

/** Queue background removal for the source range one video clip uses; the clip switches when it finishes.
 * Without a subject the person is kept; with one (e.g. "phone") only that object is.
 * With an effect, the original stays and the effect is built from it and the cut-out instead. */
export async function startCutoutFor(ctx: MutationCtx, ownerId: string, projectId: Id<'projects'>, clipId: string, rawSubject?: string, effect?: CutoutEffect) {
  if (effect) { try { validateCutoutEffect(effect); } catch (error) { throw new ConvexError(error instanceof Error ? error.message : 'Invalid effect.'); } }
  const target = effect ? CUTOUT_EFFECT_INFO[effect.kind] : undefined;
  // Object effects need something to keep; person effects use person matting unless a subject (e.g. "person" for SAM 3) is given.
  const subject = rawSubject?.trim().replace(/\s+/g, ' ').toLowerCase() || (target?.target === 'object' ? target.defaultSubject : undefined);
  if (subject && subject.length > MAX_SUBJECT_LENGTH) throw new ConvexError(`Name the object in ${MAX_SUBJECT_LENGTH} characters or fewer.`);
  await requireEditorAccess(ctx, ownerId);
  if (!await hasUltraPlan(ctx, ownerId)) throw new ConvexError(CUTOUT_PLAN_ERROR);
  const project = await requireProject(ctx, projectId, ownerId, false);
  const clip = currentTimeline(project).clips.find(item => item.id === clipId);
  if (!clip || clip.kind !== 'video' || !clip.assetId) throw new ConvexError('Choose a video clip to remove its background.');
  const sourceId = ctx.db.normalizeId('assets', clip.assetId), asset = sourceId ? await ctx.db.get(sourceId) : null;
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== project._id || asset.kind !== 'video' || !asset.duration) throw new ConvexError('This clip’s video is unavailable.');
  if (asset.cutoutOf) throw new ConvexError('This clip is already a cut-out. Restore it first.');
  // A short handle on each side keeps later small trims inside the cut-out.
  const start = Math.max(0, clip.sourceStart - HANDLE_SECONDS), end = Math.min(asset.duration, sourceEndOf(clip) + HANDLE_SECONDS);
  if (end - start > MAX_SECONDS) throw new ConvexError(`Remove the background from up to ${MAX_SECONDS / 60} minutes at a time. Split this clip first.`);
  const recent = await ctx.db.query('cutouts').withIndex('by_project', q => q.eq('projectId', project._id)).order('desc').take(50);
  const pending = recent.find(row => row.clipId === clipId && row.status === 'queued');
  if (pending && (pending.subject !== subject || pending.effect?.kind !== effect?.kind)) throw new ConvexError('Another cut-out of this clip is still processing. Try again when it finishes.');
  if (pending) return { cutoutId: pending._id, estimatedUsd: estimate(pending.end - pending.start, pending.fps, pending.subject), alreadyRunning: true, reused: false };
  // A finished cut-out of this footage that covers the clip applies again for free.
  for (const row of recent) {
    if (row.status !== 'completed' || !row.outputAssetId || row.subject !== subject || row.sourceAssetId !== asset._id || row.start > clip.sourceStart + 1e-6 || row.end < sourceEndOf(clip) - 1e-6) continue;
    const output = await ctx.db.get(row.outputAssetId);
    if (!output || output.ownerId !== ownerId || output.projectId !== project._id || !output.duration || output.duration < sourceEndOf(clip) - 1e-3) continue;
    await commitTimeline(ctx, project, placed(currentTimeline(project), clip.id, output._id, effect), project.revision ?? 0);
    return { cutoutId: row._id, estimatedUsd: 0, alreadyRunning: false, reused: true };
  }
  await requireMediaTaskCapacity(ctx, ownerId, 1);
  const fps = currentTimeline(project).fps;
  const cutoutId = await ctx.db.insert('cutouts', { ownerId, projectId: project._id, clipId, sourceAssetId: asset._id, start, end, fps, ...(subject ? { subject } : {}), ...(effect ? { effect } : {}), status: 'queued', createdAt: Date.now() });
  // Object cut-outs need a worker that knows SAM 3; older workers would keep the person instead.
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, assetId: asset._id, kind: 'cutout', cutoutId, ...(subject ? { requiredProcessorVersion: 8 } : {}) });
  await ctx.db.patch(cutoutId, { taskId });
  return { cutoutId, estimatedUsd: estimate(end - start, fps, subject), alreadyRunning: false, reused: false };
}
/** The timeline with the cut-out in place: swapped into the clip, or built into an effect around it. */
function placed(timeline: ReturnType<typeof currentTimeline>, clipId: string, outputId: Id<'assets'>, effect?: CutoutEffect): ReturnType<typeof currentTimeline> {
  if (!effect) return { ...timeline, clips: timeline.clips.map(item => item.id === clipId ? { ...item, assetId: outputId } : item) };
  try { return applyCutoutEffect(timeline, clipId, outputId, effect, () => crypto.randomUUID()) as ReturnType<typeof currentTimeline>; }
  catch (error) { throw new ConvexError(error instanceof Error ? error.message : 'The effect could not be built.'); }
}
const estimate = (seconds: number, fps = 30, subject?: string) => Math.max(0.01, Math.round(Math.ceil(seconds * fps) * USD_PER_FRAME[subject ? 'object' : 'person'] * 100) / 100);

export const startFromRun = internalMutation({ args: { projectId: v.id('projects'), ownerId: v.string(), runId: v.string(), clipId: v.string(), subject: v.optional(v.string()) }, returns: v.object({ cutoutId: v.id('cutouts'), estimatedUsd: v.number(), alreadyRunning: v.boolean(), reused: v.boolean() }), handler: async (ctx, args) => {
  const project = await readProject(ctx, args.projectId);
  if (!project || project.ownerId !== args.ownerId || project.aiRunId !== args.runId || !project.aiRunning) throw new ConvexError('AI run is no longer active');
  return startCutoutFor(ctx, args.ownerId, args.projectId, args.clipId, args.subject);
}});

export const start = mutation({ args: { projectId: v.id('projects'), clipId: v.string(), subject: v.optional(v.string()), effect: v.optional(cutoutEffectValidator) }, returns: v.object({ cutoutId: v.id('cutouts'), estimatedUsd: v.number(), alreadyRunning: v.boolean(), reused: v.boolean() }), handler: async (ctx, args) => startCutoutFor(ctx, await requireOwner(ctx), args.projectId, args.clipId, args.subject, args.effect) });

export const forProject = query({ args: { projectId: v.id('projects') }, returns: v.array(v.object({ _id: v.id('cutouts'), clipId: v.string(), subject: v.optional(v.string()), effect: v.optional(v.string()), outputAssetId: v.optional(v.id('assets')), status: v.union(v.literal('queued'), v.literal('completed'), v.literal('failed')), placed: v.optional(v.boolean()), error: v.optional(v.string()), createdAt: v.number(), progress: v.optional(v.number()) })), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  await requireProject(ctx, args.projectId, ownerId, false);
  const rows = await ctx.db.query('cutouts').withIndex('by_project', q => q.eq('projectId', args.projectId)).order('desc').take(20);
  return Promise.all(rows.filter(row => row.ownerId === ownerId).map(async row => {
    const task = row.status === 'queued' && row.taskId ? await ctx.db.get(row.taskId) : null;
    return { _id: row._id, clipId: row.clipId, ...(row.subject ? { subject: row.subject } : {}), ...(row.effect ? { effect: row.effect.kind } : {}), ...(row.outputAssetId ? { outputAssetId: row.outputAssetId } : {}), status: row.status, ...(row.placed !== undefined ? { placed: row.placed } : {}), ...(row.error ? { error: row.error } : {}), createdAt: row.createdAt, ...(task ? { progress: task.progress } : {}) };
  }));
}});

/** Swap a cut-out clip back to its original footage, keeping its timing. */
export const restore = mutation({ args: { projectId: v.id('projects'), clipId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  await requireEditorAccess(ctx, ownerId);
  const project = await requireProject(ctx, args.projectId, ownerId, false), timeline = currentTimeline(project);
  const clip = timeline.clips.find(item => item.id === args.clipId);
  const id = clip?.assetId ? ctx.db.normalizeId('assets', clip.assetId) : null, cutout = id ? await ctx.db.get(id) : null;
  if (!clip || !cutout?.cutoutOf || cutout.ownerId !== ownerId || cutout.projectId !== project._id) throw new ConvexError('This clip has no cut-out to restore.');
  // The cut-out shares the original's source timeline, so only the media changes.
  const next = { ...timeline, clips: timeline.clips.map(item => item.id === clip.id ? { ...item, assetId: cutout.cutoutOf! } : item) };
  await commitTimeline(ctx, project, next, project.revision ?? 0);
  return null;
}});

/** Point the clip at the cut-out when it still uses the processed source range; otherwise it stays in Sources. */
export async function placeCutout(ctx: MutationCtx, cutout: Doc<'cutouts'>, output: Doc<'assets'>, attempt = 0): Promise<void> {
  const project = await readProject(ctx, cutout.projectId);
  if (!project || project.deleting || project.ownerId !== cutout.ownerId) return;
  if (await editingWorkflowActive(ctx, project)) {
    // An AI edit holds the timeline; place the cut-out once it finishes.
    if (attempt < PLACEMENT_ATTEMPTS) await ctx.scheduler.runAfter(PLACEMENT_DELAY_MS, internal.cutouts.placeLater, { cutoutId: cutout._id, attempt: attempt + 1 });
    return;
  }
  const timeline = currentTimeline(project), clip = timeline.clips.find(item => item.id === cutout.clipId);
  // The cut-out leads with transparent frames, so its times are the source's; the clip must still use the processed range.
  const fits = !!clip && clip.assetId === cutout.sourceAssetId && clip.sourceStart >= cutout.start - 1e-6 && sourceEndOf(clip) <= Math.min(cutout.end, output.duration ?? 0) + 1 / timeline.fps;
  let applied = fits;
  if (fits) {
    try { await commitTimeline(ctx, project, placed(timeline, clip.id, output._id, cutout.effect), project.revision ?? 0); }
    catch (error) {
      // The cut-out stays in Sources; the effect error explains why it was not placed.
      if (!cutout.effect) throw error;
      applied = false;
      await ctx.db.patch(cutout._id, { error: (error instanceof Error ? error.message : 'The effect could not be built.').slice(0, 1000) });
    }
  }
  await ctx.db.patch(cutout._id, { placed: applied });
}

export const placeLater = internalMutation({ args: { cutoutId: v.id('cutouts'), attempt: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const cutout = await ctx.db.get(args.cutoutId), output = cutout?.outputAssetId ? await ctx.db.get(cutout.outputAssetId) : null;
  if (cutout?.status === 'completed' && output && cutout.placed === undefined) await placeCutout(ctx, cutout, output, args.attempt);
  return null;
}});
