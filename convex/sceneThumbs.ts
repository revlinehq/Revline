import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireOwner } from './lib/auth';
import { projectIdentity } from './lib/project_data';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { currentTimeline } from './lib/timeline';
import { enqueueMediaTask } from './mediaTasks';
import type { Timeline } from '../lib/editor/types';
import { sceneThumbKey } from '../lib/editor/scene-thumb-key';

// Motion clips on the timeline show real frames of themselves: a few frames of the clip alone, rendered by the
// media worker in the background and kept until the clip's code, blueprints, media or length change (sceneThumbKey).
const FRAMES = 6, STARTS_PER_CALL = 2, STALE_MS = 180_000;
const frame = v.object({ time: v.number(), image: v.string() });

const latest = (ctx: QueryCtx, projectId: Id<'projects'>, key: string) => ctx.db.query('frameSnapshots').withIndex('by_project_key', q => q.eq('projectId', projectId).eq('key', key)).order('desc').first();
const sceneClips = (timeline: Timeline) => timeline.clips.filter(clip => clip.kind === 'scene' && clip.scene);

// Frames rows carry their images, and the project document changes on every edit. So the editor computes each
// clip's key from the timeline it already has and subscribes per clip: no read of the project, its scene code or
// other clips' images, and a clip's query re-runs only when its own frames change.
/** One motion clip's frames: its current version's when finished, else its last finished ones while the new ones render. */
export const forClip = query({ args: { projectId: v.id('projects'), clipId: v.string(), key: v.string() }, returns: v.object({ frames: v.union(v.array(frame), v.null()), current: v.boolean(), rendering: v.boolean() }), handler: async (ctx, args) => {
  await projectIdentity(ctx, args.projectId, await requireOwner(ctx));
  if (!args.key.startsWith(`${args.clipId}:`)) return { frames: null, current: false, rendering: false };
  const row = await latest(ctx, args.projectId, args.key);
  if (row?.status === 'completed' && row.frames) return { frames: row.frames, current: true, rendering: false };
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
    if (wanted && !wanted.has(clip.id)) continue;
    const key = sceneThumbKey(clip, timeline), row = await latest(ctx, project._id, key);
    if (row?.status === 'completed') continue;
    if (row && row.status === 'queued' && row.createdAt > Date.now() - STALE_MS) continue;
    if (started >= STARTS_PER_CALL) break;
    // Previews never take a slot the user's own work needs.
    try { await requireMediaTaskCapacity(ctx, ownerId, 1); } catch { break; }
    // Stale or failed requests go; the newest finished frames stay on screen until the new ones land.
    const others = await ctx.db.query('frameSnapshots').withIndex('by_project_clip', q => q.eq('projectId', project._id).eq('clipId', clip.id)).take(6);
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
  const ids = [...new Set([share.timeline, ...rows.map(row => row.timeline)].flatMap(timeline => sceneClips(timeline).map(clip => clip.id)))].slice(0, 60);
  const frames: Record<string, { time: number; image: string }[]> = {};
  for (const clipId of ids) { const found = await clipFrames(ctx, share.projectId, clipId); if (found) frames[clipId] = found; }
  return frames;
}});
