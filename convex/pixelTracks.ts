import { tableRow } from './lib/exact';
import { ConvexError, v } from 'convex/values';
import { mutation, internalQuery, httpAction, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { requireMediaTask } from './lib/media_task_auth';
import { mediaTaskCredentials } from './lib/media_task_contract';
import { pixelTrackHeaderValidator, pixelTrackSampleValidator, pixelTrackReferenceValidator, pixelTrackPageValidator } from './lib/pixel_track_validator';
import { pixelTrackHeader, pixelTrackChunk, summarizePixelTrack, type PixelTrackPage } from '../lib/media-analysis/pixel-track';

export const begin = mutation({ args: { ...mediaTaskCredentials, header: pixelTrackHeaderValidator }, returns: v.null(), handler: async (ctx, args) => {
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken), row = task.derivationId ? await ctx.db.get(task.derivationId) : null;
  if (!row || row.op !== 'pixelTrack' || row.status !== 'queued') throw new ConvexError('Tracking request is not active.');
  await ctx.db.patch(row._id, { trackingAttempt: task.attempt, trackingHeader: pixelTrackHeader.parse(args.header), trackingCount: 0 });
  return null;
} });

export const append = mutation({ args: { ...mediaTaskCredentials, direction: v.union(v.literal('forward'), v.literal('backward')), sequence: v.number(), samples: v.array(pixelTrackSampleValidator) }, returns: v.null(), handler: async (ctx, args) => {
  const task = await requireMediaTask(ctx, args.taskId, args.leaseToken), row = task.derivationId ? await ctx.db.get(task.derivationId) : null;
  if (!row || row.op !== 'pixelTrack' || row.status !== 'queued' || row.trackingAttempt !== task.attempt || !row.tracking) throw new ConvexError('Tracking request is not active.');
  const chunk = pixelTrackChunk.parse({ direction: args.direction, sequence: args.sequence, samples: args.samples }), samples = chunk.samples;
  if (samples.some((sample, index) => sample.time < row.tracking!.start - 1e-6 || sample.time >= row.tracking!.end || index > 0 && (sample.frameIndex !== samples[index - 1].frameIndex + 1 || sample.time <= samples[index - 1].time))) throw new ConvexError('Invalid tracking frame chunk.');
  const existing = await ctx.db.query('pixelTrackChunks').withIndex('by_track_attempt_sequence', q => q.eq('derivationId', row._id).eq('attempt', task.attempt).eq('direction', chunk.direction).eq('sequence', chunk.sequence)).unique();
  if (existing) return null;
  if (chunk.sequence > 0) {
    const previous = await ctx.db.query('pixelTrackChunks').withIndex('by_track_attempt_sequence', q => q.eq('derivationId', row._id).eq('attempt', task.attempt).eq('direction', chunk.direction).eq('sequence', chunk.sequence - 1)).unique();
    if (!previous || (chunk.direction === 'forward' ? previous.samples[previous.samples.length - 1].frameIndex + 1 !== samples[0].frameIndex : samples[samples.length - 1].frameIndex + 1 !== previous.samples[0].frameIndex)) throw new ConvexError('Tracking chunks must be contiguous.');
  }
  await ctx.db.insert('pixelTrackChunks', tableRow<'pixelTrackChunks'>()({ ownerId: row.ownerId, projectId: row.projectId, derivationId: row._id, attempt: task.attempt, ...chunk, start: samples[0].time, end: samples[samples.length - 1].time }));
  await ctx.db.patch(row._id, { trackingCount: (row.trackingCount ?? 0) + samples.length });
  return null;
} });

const runArgs = { projectId: v.id('projects'), ownerId: v.string(), runId: v.string(), trackId: v.string() };
async function owned(ctx: QueryCtx, args: { projectId: Doc<'derivations'>['projectId']; ownerId: string; trackId: string }) {
  const id = ctx.db.normalizeId('derivations', args.trackId), row = id ? await ctx.db.get(id) : null;
  if (!row || row.projectId !== args.projectId || row.ownerId !== args.ownerId || row.op !== 'pixelTrack') throw new ConvexError('Track not found in this project.');
  return row;
}
export const referenceForRun = internalQuery({ args: runArgs, returns: pixelTrackReferenceValidator, handler: async (ctx, args) => {
  const row = await owned(ctx, args);
  if (!row.trackingToken) throw new ConvexError('Track needs to be measured with the current processor.');
  return { trackId: row._id, token: row.trackingToken };
} });

async function page(ctx: QueryCtx, row: Doc<'derivations'>, time?: number, cursor?: number): Promise<PixelTrackPage> {
  if (row.status === 'failed') return { status: 'failed', error: row.error ?? 'Tracking failed.' };
  if (row.status !== 'completed' || !row.pixelTrack) return { status: 'queued', sampleCount: row.trackingCount ?? 0 };
  const summary = summarizePixelTrack(row.pixelTrack);
  if (row.pixelTrack.engine === 'opencv-klt-template-v1') {
    const samples = row.pixelTrack.samples.filter(sample => sample.time >= (cursor ?? -Infinity));
    return { status: 'completed', summary, samples, window: { start: summary.firstTime, end: summary.forward.time }, nextCursor: null };
  }
  const attempt = row.trackingAttempt ?? 0;
  const after = await ctx.db.query('pixelTrackChunks').withIndex('by_track_attempt_start', q => q.eq('derivationId', row._id).eq('attempt', attempt).gte('start', cursor ?? summary.firstTime)).order('asc').take(time === undefined ? 2 : 1);
  if (time === undefined) {
    const chunk = after[0];
    return { status: 'completed', summary, samples: chunk?.samples ?? [], window: { start: chunk?.start ?? summary.firstTime, end: after[1]?.start ?? summary.forward.time }, nextCursor: after[1]?.start ?? null };
  }
  const before = await ctx.db.query('pixelTrackChunks').withIndex('by_track_attempt_start', q => q.eq('derivationId', row._id).eq('attempt', attempt).lte('start', time)).order('desc').take(2);
  const next = await ctx.db.query('pixelTrackChunks').withIndex('by_track_attempt_start', q => q.eq('derivationId', row._id).eq('attempt', attempt).gt('start', time)).order('asc').take(1);
  const chunks = [...before.reverse(), ...next].sort((a, b) => a.start - b.start);
  return { status: 'completed', summary, samples: chunks.flatMap(chunk => chunk.samples), window: { start: before[before.length - 1]?.start ?? summary.firstTime, end: next[0]?.start ?? summary.forward.time }, nextCursor: next[0]?.start ?? null };
}
export const pageForRun = internalQuery({ args: { ...runArgs, time: v.optional(v.number()), cursor: v.optional(v.number()) }, returns: pixelTrackPageValidator, handler: async (ctx, args) => page(ctx, await owned(ctx, args), args.time, args.cursor) });
export const read = internalQuery({ args: { trackId: v.string(), token: v.string(), time: v.optional(v.number()), cursor: v.optional(v.number()) }, returns: pixelTrackPageValidator, handler: async (ctx, args) => {
  const id = ctx.db.normalizeId('derivations', args.trackId), row = id ? await ctx.db.get(id) : null;
  const project = row ? await ctx.db.get(row.projectId) : null;
  if (!row || !project || project.deleting || !args.token || row.trackingToken !== args.token) throw new ConvexError('Track access is no longer available.');
  return page(ctx, row, args.time, args.cursor);
} });
const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
export const serve = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  try {
    const time = params.has('time') ? Number(params.get('time')) : undefined, cursor = params.has('cursor') ? Number(params.get('cursor')) : undefined;
    if (time !== undefined && !Number.isFinite(time) || cursor !== undefined && !Number.isFinite(cursor)) return new Response('Invalid source time', { status: 400, headers });
    const result = await ctx.runQuery(internal.pixelTracks.read, { trackId: params.get('trackId') ?? '', token: params.get('token') ?? '', ...(time === undefined ? {} : { time }), ...(cursor === undefined ? {} : { cursor }) });
    return new Response(JSON.stringify(result), { headers: { ...headers, 'Cache-Control': result.status === 'completed' ? 'private, max-age=3600' : 'no-store' } });
  } catch { return new Response('Track unavailable', { status: 404, headers }); }
});
