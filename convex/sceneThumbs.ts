import { v } from 'convex/values';
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireOwner } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { currentTimeline } from './lib/timeline';
import { cancelMediaTask, enqueueMediaTask } from './mediaTasks';
import type { Timeline } from '../lib/editor/types';
import { withoutSceneCode } from '../lib/editor/scene-code';
import { sceneThumbKey } from '../lib/editor/scene-thumb-key';

// Motion clips on the timeline show real frames of themselves: a few frames of the clip alone, rendered by the
// media worker in the background and kept until the clip's code, blueprints, media or length change (sceneThumbKey).
const FRAMES = 6, STARTS_PER_CALL = 2, STALE_MS = 180_000;
const frame = v.object({ time: v.number(), image: v.string() });

const latest = (ctx: QueryCtx, projectId: Id<'projects'>, key: string) => ctx.db.query('sceneThumbnails').withIndex('by_project_key', q => q.eq('projectId', projectId).eq('key', key)).order('desc').first();
const sceneClips = (timeline: Timeline) => timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene);
async function images(ctx: QueryCtx, row: Doc<'sceneThumbnails'> | null) {
  if (!row?.frames) return null;
  const frames = await Promise.all(row.frames.map(async frame => ({ time: frame.time, image: await ctx.storage.getUrl(frame.storageId) })));
  return frames.flatMap(frame => frame.image ? [{ time: frame.time, image: frame.image }] : []);
}

// The editor computes each key from its existing timeline. Each subscription reads only that clip's small
// metadata row; image bytes live in file storage and load through ordinary browser image requests.
/** One motion clip's frames: its current version's when finished, else its last finished ones while the new ones render. */
export const forClip = query({ args: { projectId: v.id('projects'), clipId: v.string(), key: v.string() }, returns: v.object({ frames: v.union(v.array(frame), v.null()), current: v.boolean(), rendering: v.boolean() }), handler: async (ctx, args) => {
  await projectIdentity(ctx, args.projectId, await requireOwner(ctx));
  if (!args.key.startsWith(`${args.clipId}:`)) return { frames: null, current: false, rendering: false };
  const row = await latest(ctx, args.projectId, args.key);
  if (row?.status === 'completed' && row.frames) return { frames: await images(ctx, row), current: true, rendering: false };
  const rendering = row?.status === 'queued' && row.createdAt > Date.now() - STALE_MS;
  return { frames: (await clipFrames(ctx, args.projectId, args.clipId)) ?? null, current: false, rendering };
}});

/** Queue frames for the listed motion clips that have none for their current version, a couple at a time. */
export const ensure = mutation({ args: { projectId: v.id('projects'), clipIds: v.optional(v.array(v.string())) }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  try { await requireEditorAccess(ctx, ownerId); } catch { return null; }
  // The stored document, without scene code or run state: keys use code refs, as the editor computes them.
  const project = await ctx.db.get(args.projectId);
  if (!project || project.deleting || project.ownerId !== ownerId) return null;
  const timeline = currentTimeline(project), wanted = args.clipIds && new Set(args.clipIds);
  let started = 0;
  for (const clip of sceneClips(timeline)) {
    if (started >= STARTS_PER_CALL) break;
    if (wanted && !wanted.has(clip.id)) continue;
    const key = sceneThumbKey(clip, timeline), row = await latest(ctx, project._id, key);
    if (row?.status === 'completed') continue;
    if (row && row.status === 'queued' && row.createdAt > Date.now() - STALE_MS) continue;
    // Previews never take a slot the user's own work needs.
    try { await requireMediaTaskCapacity(ctx, ownerId, 1); } catch { break; }
    // Stale or failed requests go; the newest finished frames stay on screen until the new ones land.
    for (const status of ['queued', 'failed'] as const) for (const old of await ctx.db.query('sceneThumbnails').withIndex('by_project_clip_status', q => q.eq('projectId', project._id).eq('clipId', clip.id).eq('status', status)).take(6)) {
      if (old.taskId) await cancelMediaTask(ctx, old.taskId);
      await deleteThumbnail(ctx, old);
    }
    const times = Array.from({ length: FRAMES }, (_, i) => Math.round((i + .5) / FRAMES * clip.duration * timeline.fps) / timeline.fps);
    const snapshotId = await ctx.db.insert('frameSnapshots', { projectId: project._id, ownerId, revision: project.revision ?? 0, times, status: 'queued', createdAt: Date.now(), clipId: clip.id, key });
    const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, kind: 'snapshot', snapshotId });
    await ctx.db.patch(snapshotId, { taskId });
    await ctx.db.insert('sceneThumbnails', { projectId: project._id, ownerId, clipId: clip.id, key, snapshotId, taskId, status: 'queued', createdAt: Date.now() });
    started++;
  }
  return null;
}});

/** The newest finished frames of one clip, whichever version of it they show. */
const clipFrames = async (ctx: QueryCtx, projectId: Id<'projects'>, clipId: string) => images(ctx, await ctx.db.query('sceneThumbnails').withIndex('by_project_clip_status', q => q.eq('projectId', projectId).eq('clipId', clipId).eq('status', 'completed')).order('desc').first());

/** Frames for motion clips of any timeline tab, by clip id: tab previews use the first one. */
export const forClips = query({ args: { projectId: v.id('projects'), clipIds: v.array(v.string()) }, returns: v.record(v.string(), v.array(frame)), handler: async (ctx, args) => {
  const project = await projectIdentity(ctx, args.projectId, await requireOwner(ctx));
  const frames: Record<string, { time: number; image: string }[]> = {};
  for (const clipId of [...new Set(args.clipIds)].slice(0, 24)) { const found = await clipFrames(ctx, project._id, clipId); if (found) frames[clipId] = found; }
  return frames;
}});

/** Frames for the motion clips of a published share, so people opening the link see them on its timeline. */
export const forShare = query({ args: { shareId: v.string() }, returns: v.record(v.string(), v.array(frame)), handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('timelineShares', args.shareId), share = id ? await ctx.db.get(id) : null;
  if (!share?.published) return {};
  const rows = share.tabCount ? await ctx.db.query('shareTimelines').withIndex('by_share', q => q.eq('shareId', share._id)).take(20) : [];
  const frames: Record<string, { time: number; image: string }[]> = {};
  let checked = 0;
  for (const published of [share.timeline, ...rows.map(row => row.timeline)]) {
    // Legacy shares may still have inline code; thumbnail keys use its hash.
    const { timeline } = await withoutSceneCode(published);
    for (const clip of sceneClips(timeline)) {
      if (checked++ >= 60) return frames;
      const found = await images(ctx, await latest(ctx, share.projectId, sceneThumbKey(clip, timeline)));
      if (found) frames[clip.id] = found;
    }
  }
  return frames;
}});

export async function deleteThumbnail(ctx: MutationCtx, row: Doc<'sceneThumbnails'>) {
  for (const frame of row.frames ?? []) await ctx.storage.delete(frame.storageId);
  const snapshot = await ctx.db.get(row.snapshotId);
  if (snapshot) await ctx.db.delete(snapshot._id);
  await ctx.db.delete(row._id);
}

/** Old workers still finish with base64. Only this one-shot action reads it; subscriptions read file ids. */
export const pendingImages = internalQuery({ args: { snapshotId: v.id('frameSnapshots') }, handler: async (ctx, args) => {
  const snapshot = await ctx.db.get(args.snapshotId);
  return snapshot?.clipId && snapshot.key && snapshot.status === 'completed' && snapshot.frames ? snapshot.frames : null;
}});
export const storeImages = internalAction({ args: { snapshotId: v.id('frameSnapshots') }, returns: v.null(), handler: async (ctx, args) => {
  const frames = await ctx.runQuery(internal.sceneThumbs.pendingImages, args);
  if (!frames) return null;
  const saved: { time: number; storageId: Id<'_storage'> }[] = [];
  try {
    for (const frame of frames) saved.push({ time: frame.time, storageId: await ctx.storage.store(new Blob([Uint8Array.from(atob(frame.image), char => char.charCodeAt(0))], { type: 'image/jpeg' })) });
    await ctx.runMutation(internal.sceneThumbs.finishImages, { ...args, frames: saved });
  } catch (error) { for (const frame of saved) await ctx.storage.delete(frame.storageId); throw error; }
  return null;
}});
export const finishImages = internalMutation({ args: { snapshotId: v.id('frameSnapshots'), frames: v.array(v.object({ time: v.number(), storageId: v.id('_storage') })) }, returns: v.null(), handler: async (ctx, args) => {
  const row = await ctx.db.query('sceneThumbnails').withIndex('by_snapshot', q => q.eq('snapshotId', args.snapshotId)).unique();
  if (!row || row.status === 'completed') { for (const frame of args.frames) await ctx.storage.delete(frame.storageId); return null; }
  await ctx.db.patch(row._id, { status: 'completed', frames: args.frames });
  await ctx.db.delete(args.snapshotId);
  const completed = await ctx.db.query('sceneThumbnails').withIndex('by_project_clip_status', q => q.eq('projectId', row.projectId).eq('clipId', row.clipId).eq('status', 'completed')).order('desc').take(8);
  for (const old of completed.slice(1)) await deleteThumbnail(ctx, old);
  return null;
}});
