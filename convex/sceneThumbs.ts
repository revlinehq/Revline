import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireOwner, requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { currentTimeline } from './lib/timeline';
import { enqueueMediaTask } from './mediaTasks';
import type { Clip, Timeline } from '../lib/editor/types';

// Motion clips on the timeline show real frames of themselves: a few frames of the clip alone, rendered by the
// media worker in the background and kept until the clip's code, blueprints, media or length change.
const FRAMES = 6, STARTS_PER_CALL = 2, STALE_MS = 180_000;
const frame = v.object({ time: v.number(), image: v.string() });

/** What a clip's frames depend on, hashed (FNV-1a): code is stored by hash, so its ref stands in for it. */
function sceneKey(clip: Clip, timeline: Timeline) {
  const scene = clip.scene!, ref = (item: { code: string; codeRef?: string }) => item.codeRef ?? item.code;
  const text = JSON.stringify([ref(scene), (scene.blueprints ?? []).map(ref), scene.media, scene.brand, scene.film, clip.duration, clip.sourceStart, timeline.aspectRatio, timeline.fps]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return `${clip.id}:${(hash >>> 0).toString(36)}`;
}
const latest = (ctx: QueryCtx, projectId: Id<'projects'>, key: string) => ctx.db.query('frameSnapshots').withIndex('by_project_key', q => q.eq('projectId', projectId).eq('key', key)).order('desc').first();
const sceneClips = (timeline: Timeline) => timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene);

/** The finished frames for each motion clip of the saved timeline, by clip id. */
export const forProject = query({ args: { projectId: v.id('projects') }, returns: v.record(v.string(), v.array(frame)), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), project = await requireProject(ctx, args.projectId, ownerId, false), timeline = currentTimeline(project);
  const frames: Record<string, Doc<'frameSnapshots'>['frames'] & {}> = {};
  for (const clip of sceneClips(timeline)) {
    const row = await latest(ctx, project._id, sceneKey(clip, timeline));
    if (row?.status === 'completed' && row.frames) { frames[clip.id] = row.frames; continue; }
    // While a changed clip renders again (or if that render failed), keep showing its last frames.
    const previous = (await ctx.db.query('frameSnapshots').withIndex('by_project_clip', q => q.eq('projectId', project._id).eq('clipId', clip.id)).order('desc').take(3)).find(row => row.status === 'completed');
    if (previous?.frames) frames[clip.id] = previous.frames;
  }
  return frames;
}});

/** Motion clips whose current frames are queued or rendering, so their placeholder can show that frames are on the way. */
export const renderingForProject = query({ args: { projectId: v.id('projects') }, returns: v.array(v.string()), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), project = await requireProject(ctx, args.projectId, ownerId, false), timeline = currentTimeline(project);
  const rendering: string[] = [];
  for (const clip of sceneClips(timeline)) {
    const row = await latest(ctx, project._id, sceneKey(clip, timeline));
    if (row?.status === 'queued' && row.createdAt > Date.now() - STALE_MS) rendering.push(clip.id);
  }
  return rendering;
}});

/** Queue frames for motion clips that have none for their current version, a couple at a time. */
export const ensure = mutation({ args: { projectId: v.id('projects') }, returns: v.null(), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx);
  try { await requireEditorAccess(ctx, ownerId); } catch { return null; }
  const project = await requireProject(ctx, args.projectId, ownerId, false), timeline = currentTimeline(project);
  let started = 0;
  for (const clip of sceneClips(timeline)) {
    const key = sceneKey(clip, timeline), row = await latest(ctx, project._id, key);
    const others = await ctx.db.query('frameSnapshots').withIndex('by_project_clip', q => q.eq('projectId', project._id).eq('clipId', clip.id)).take(6);
    // Current frames are in: older versions of this clip can go.
    if (row?.status === 'completed') { for (const old of others) if (old._id !== row._id) await ctx.db.delete(old._id); continue; }
    if (row && row.status === 'queued' && row.createdAt > Date.now() - STALE_MS) continue;
    if (started >= STARTS_PER_CALL) break;
    // Previews never take a slot the user's own work needs.
    try { await requireMediaTaskCapacity(ctx, ownerId, 1); } catch { break; }
    // Stale or failed requests go; the newest finished frames stay on screen until the new ones land.
    const keep = others.filter(old => old.status === 'completed').sort((a, b) => b.createdAt - a.createdAt)[0];
    for (const old of others) if (old !== keep) await ctx.db.delete(old._id);
    const times = Array.from({ length: FRAMES }, (_, i) => Math.round((i + .5) / FRAMES * clip.duration * timeline.fps) / timeline.fps);
    const snapshotId = await ctx.db.insert('frameSnapshots', { projectId: project._id, ownerId, revision: project.revision ?? 0, times, status: 'queued', createdAt: Date.now(), clipId: clip.id, key });
    const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, kind: 'snapshot', snapshotId });
    await ctx.db.patch(snapshotId, { taskId });
    started++;
  }
  return null;
}});

/** The newest finished frames of one clip, whichever version of it they show. */
const clipFrames = async (ctx: QueryCtx, projectId: Id<'projects'>, clipId: string) => (await ctx.db.query('frameSnapshots').withIndex('by_project_clip', q => q.eq('projectId', projectId).eq('clipId', clipId)).order('desc').take(3)).find(row => row.status === 'completed' && row.frames?.length)?.frames;

/** Frames for motion clips of any timeline tab, by clip id: tab previews use the first one. */
export const forClips = query({ args: { projectId: v.id('projects'), clipIds: v.array(v.string()) }, returns: v.record(v.string(), v.array(frame)), handler: async (ctx, args) => {
  const ownerId = await requireOwner(ctx), project = await requireProject(ctx, args.projectId, ownerId, false);
  const frames: Record<string, { time: number; image: string }[]> = {};
  for (const clipId of [...new Set(args.clipIds)].slice(0, 24)) { const found = await clipFrames(ctx, project._id, clipId); if (found) frames[clipId] = found; }
  return frames;
}});

/** Frames for the motion clips of a published share, so people opening the link see them on its timeline. */
export const forShare = query({ args: { shareId: v.string() }, returns: v.record(v.string(), v.array(frame)), handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('timelineShares', args.shareId), share = id ? await ctx.db.get(id) : null;
  if (!share?.published) return {};
  const rows = share.tabCount ? await ctx.db.query('shareTimelines').withIndex('by_share', q => q.eq('shareId', share._id)).take(20) : [];
  const ids = [...new Set([share.timeline, ...rows.map(row => row.timeline)].flatMap(timeline => sceneClips(timeline).map(clip => clip.id)))].slice(0, 60);
  const frames: Record<string, { time: number; image: string }[]> = {};
  for (const clipId of ids) { const found = await clipFrames(ctx, share.projectId, clipId); if (found) frames[clipId] = found; }
  return frames;
}});
