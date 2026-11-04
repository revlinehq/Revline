import { ConvexError, v } from 'convex/values';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireProject } from './lib/auth';
import { mergeMotionWindows } from '../lib/ai/motion-coverage';
import { compareMotion, type MotionMap, type MotionDifference } from '../lib/inspo-motion/motion-map';
import { runMotionRead } from './referenceReads';
import { referenceBox, referenceCropKeyframesValidator } from './schema';
import type { ComparisonCrop } from '../lib/ai/reference-comparison';

const source = { ownerId: v.string(), projectId: v.id('projects'), assetId: v.id('assets') };
const window = { start: v.number(), end: v.number() };
const difference = v.object({ time: v.number(), issue: v.string(), fix: v.optional(v.string()) });
const check = { ...window, timelineStart: v.number(), revision: v.number(), timelineKey: v.string(), scope: v.string(), checkedAt: v.number(), differences: v.array(difference) };
const off = { ...window, time: v.number(), reason: v.string() };
type MotionSnapshot = { status: 'queued' | 'completed' | 'failed'; start: number; end: number; revision: number; timelineKey: string; timelineId: string; checkedAt: number; map: MotionMap | null; error: string | null; comparison: { crop?: ComparisonCrop; aspectRatio?: number } | null };
type MeasuredMotion = { reference: MotionMap; timeline?: MotionMap; differences?: MotionDifference[]; revision?: number };

/** Persist the existing readFrames single-mapped-reference detection across separate MCP calls. */
export const noteReference = internalMutation({ args: { ...source, timelineId: v.string(), select: v.optional(v.boolean()) }, returns: v.null(), handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId, false);
  const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.projectId !== args.projectId || asset.ownerId !== args.ownerId || asset.kind !== 'video') throw new ConvexError('Choose a reference video in this project.');
  if (args.select) {
    const sources = await ctx.db.query('assets').withIndex('by_ownerId_projectId', q => q.eq('ownerId', args.ownerId).eq('projectId', args.projectId)).take(400);
    for (const source of sources) if (source._id !== asset._id && source.motionReferenceTimelines?.includes(args.timelineId)) await ctx.db.patch(source._id, { motionReferenceTimelines: source.motionReferenceTimelines.filter(id => id !== args.timelineId) });
  }
  if (!asset.motionReferenceTimelines?.includes(args.timelineId)) await ctx.db.patch(asset._id, { motionReferenceTimelines: [...asset.motionReferenceTimelines ?? [], args.timelineId] });
  return null;
} });

export const state = internalQuery({ args: { ...source, timelineId: v.string() }, returns: v.object({ windows: v.array(v.object(window)), checks: v.array(v.object(check)), off: v.array(v.object(off)) }), handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId, false);
  const coverage = await ctx.db.query('referenceMotionCoverage').withIndex('by_project_asset', q => q.eq('projectId', args.projectId).eq('assetId', args.assetId)).unique();
  const checks = await ctx.db.query('referenceMotionChecks').withIndex('by_project_timeline_asset', q => q.eq('projectId', args.projectId).eq('timelineId', args.timelineId).eq('assetId', args.assetId)).take(1000);
  const exceptions = await ctx.db.query('referenceMotionOff').withIndex('by_project_timeline_asset', q => q.eq('projectId', args.projectId).eq('timelineId', args.timelineId).eq('assetId', args.assetId)).take(1000);
  return { windows: coverage?.windows ?? [], checks: checks.map(({ start, end, timelineStart, revision, timelineKey, scope, checkedAt, differences }) => ({ start, end, timelineStart, revision, timelineKey, scope, checkedAt, differences })), off: exceptions.map(({ start, end, time, reason }) => ({ start, end, time, reason })) };
} });

/** Only the measurement action can write coverage or differences; neither is a tool argument. */
export const record = internalMutation({ args: { ...source, ...window, comparison: v.optional(v.object({ timelineId: v.string(), ...check })) }, returns: v.null(), handler: async (ctx, { comparison, ...args }) => {
  await requireProject(ctx, args.projectId, args.ownerId, false);
  const row = await ctx.db.query('referenceMotionCoverage').withIndex('by_project_asset', q => q.eq('projectId', args.projectId).eq('assetId', args.assetId)).unique();
  const windows = mergeMotionWindows([...(row?.windows ?? []), { start: args.start, end: args.end }]);
  if (row) await ctx.db.patch(row._id, { windows });
  else await ctx.db.insert('referenceMotionCoverage', { ownerId: args.ownerId, projectId: args.projectId, assetId: args.assetId, windows });
  if (comparison) {
    const previous = await ctx.db.query('referenceMotionChecks').withIndex('by_window', q => q.eq('projectId', args.projectId).eq('timelineId', comparison.timelineId).eq('assetId', args.assetId).eq('start', comparison.start).eq('end', comparison.end).eq('scope', comparison.scope)).unique();
    // A slow older check cannot overwrite a newer frozen snapshot's evidence.
    if (!previous) await ctx.db.insert('referenceMotionChecks', { ...args, ...comparison });
    else if (comparison.checkedAt >= previous.checkedAt) await ctx.db.patch(previous._id, comparison);
  }
  return null;
} });

export const markOff = internalMutation({ args: { ...source, timelineId: v.string(), ...off }, returns: v.null(), handler: async (ctx, args) => {
  await requireProject(ctx, args.projectId, args.ownerId, false);
  const asset = await ctx.db.get(args.assetId);
  if (!asset || asset.projectId !== args.projectId || asset.ownerId !== args.ownerId || asset.kind !== 'video') throw new ConvexError('Choose the actual reference video in this project.');
  if (!(args.start >= 0 && args.end > args.start && args.end - args.start <= 12 && args.end <= (asset.duration ?? Infinity) + .001 && args.time >= args.start && args.time <= args.end) || args.reason.trim().length < 12 || args.reason.length > 500) throw new ConvexError('Mark off a reference window of up to 12 s with a time inside it and a concrete reason (12–500 characters). Off never means matched.');
  const existing = await ctx.db.query('referenceMotionOff').withIndex('by_project_timeline_asset', q => q.eq('projectId', args.projectId).eq('timelineId', args.timelineId).eq('assetId', args.assetId)).take(1000);
  const same = existing.find(item => item.start === args.start && item.end === args.end);
  if (same) await ctx.db.patch(same._id, { time: args.time, reason: args.reason.trim() });
  else await ctx.db.insert('referenceMotionOff', { ...args, reason: args.reason.trim() });
  return null;
} });

export const snapshot = internalQuery({ args: { ownerId: v.string(), projectId: v.id('projects'), snapshotId: v.id('frameSnapshots') }, returns: v.any(), handler: async (ctx, args): Promise<MotionSnapshot> => {
  const saved = await ctx.db.get(args.snapshotId);
  if (!saved || saved.ownerId !== args.ownerId || saved.projectId !== args.projectId || !saved.motion || !saved.motionKey) throw new ConvexError('Choose a real timeline motion render from this project.');
  return { status: saved.status, start: saved.motion.start, end: saved.motion.end, revision: saved.revision, timelineKey: saved.motionKey, timelineId: saved.timelineId ?? '', checkedAt: saved.createdAt, map: saved.motionResult as MotionMap ?? null, error: saved.error ?? null, comparison: saved.comparison ?? null };
} });

/** Differences are computed here from real worker output, never supplied by the model. */
export const measure = internalAction({ args: { ...source, ...window, recreation: v.boolean(), snapshotId: v.optional(v.id('frameSnapshots')), referenceCrop: v.optional(referenceBox), referenceCropKeyframes: v.optional(referenceCropKeyframesValidator) }, returns: v.any(), handler: async (ctx, args): Promise<MeasuredMotion> => {
  if (!(args.start >= 0 && args.end - args.start >= .3 && args.end - args.start <= 12)) throw new ConvexError('Choose a motion window of 0.3 to 12 seconds.');
  const referencePromise = runMotionRead(ctx, args.ownerId, args.projectId, args.assetId, args.start, args.end, undefined, args.referenceCrop, args.referenceCropKeyframes, args.recreation).then(async reference => {
    // Record only the span actually measured, including a truncated tail at the video's end.
    if (!reference || reference.fps < 10 || reference.end - reference.start < .3) throw new ConvexError('The reference returned no measurable motion window. Retry motionMap or mark this window off with its time and reason.');
    await ctx.runMutation(internal.referenceMotion.record, { ownerId: args.ownerId, projectId: args.projectId, assetId: args.assetId, start: reference.start, end: reference.end });
    return reference;
  });
  const snapshotPromise = async (): Promise<MotionSnapshot | null> => {
    if (!args.snapshotId) return null;
    const deadline = Date.now() + 300_000;
    for (;;) {
      const saved = await ctx.runQuery(internal.referenceMotion.snapshot, { ownerId: args.ownerId, projectId: args.projectId, snapshotId: args.snapshotId });
      if (saved.status === 'completed') return saved;
      if (saved.status === 'failed') {
        if (saved.error?.startsWith('Still queued after')) throw new ConvexError({ status: 'still_queued', retryAfterSeconds: 30, message: saved.error });
        throw new ConvexError(saved.error ?? 'The timeline motion render failed. Retry motionMap or mark the window off.');
      }
      if (Date.now() >= deadline) throw new ConvexError({ status: 'still_queued', retryAfterSeconds: 30, message: 'The motion check is still queued or rendering. Wait about 30 s and retry; this check has not passed.' });
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  };
  const results = await Promise.allSettled([referencePromise, snapshotPromise()]);
  const [read, rendered] = results;
  if (read.status === 'rejected') throw read.reason;
  if (rendered.status === 'rejected') throw rendered.reason;
  const reference = read.value, saved = rendered.value;
  if (!saved) return { reference };
  const timeline = saved.map as MotionMap;
  if (!timeline || timeline.fps < 10 || Math.abs((timeline.end - timeline.start) - (reference.end - reference.start)) > .05) throw new ConvexError('The motion render did not cover the reference window. Retry with matching bounds or mark the window off.');
  const differences = compareMotion(reference, timeline);
  const regions = [args.referenceCrop ?? null, args.referenceCropKeyframes ?? null, saved.comparison?.crop ?? null];
  const scope = regions.some(Boolean) ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(regions)))), byte => byte.toString(16).padStart(2, '0')).join('') : 'full';
  await ctx.runMutation(internal.referenceMotion.record, { ownerId: args.ownerId, projectId: args.projectId, assetId: args.assetId, start: reference.start, end: reference.end, comparison: { start: reference.start, end: reference.end, timelineStart: saved.start, timelineId: saved.timelineId, revision: saved.revision, timelineKey: saved.timelineKey, scope, checkedAt: saved.checkedAt, differences } });
  return { reference, timeline, differences, revision: saved.revision };
} });
