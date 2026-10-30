import { ConvexError, v, type Infer } from 'convex/values';
import { z } from 'zod';
import { internalMutation, internalQuery, type ActionCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { enqueueMediaTask } from './mediaTasks';
import { blueprintLineValidator, blueprintPointValidator, referenceBox, referenceReadResult } from './schema';

// Reading a source video for an agent: the worker cuts frames into one labeled sheet image the model looks at,
// follows a boxed object frame by frame, or reads exact pixels of one frame. Times and boxes are SOURCE seconds and pixels.

const box = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() });
const window = { assetId: z.string().min(1), start: z.number().min(0).describe('SOURCE seconds.'), end: z.number().min(0).describe('SOURCE seconds.') };
export const READ_TOOL_INPUTS = {
  readFrames: z.object({ ...window, count: z.number().int().min(1).max(30).optional().describe('Frames spread evenly from start to end (default 8, up to 30).'), fps: z.number().min(1).max(30).optional().describe('Read consecutive moments instead: frames at this rate from start (10 for a transition), up to 30 frames, so a 1.5 to 3 s window shows the motion itself.'), crop: box.optional().describe('Zoom into this part of the frame, in source pixels, to read small type, icons and edges.') }).strict(),
  trackReference: z.object({ ...window, box: box.describe('The object in the frame at start, in source pixels (from a readFrames sheet).') }).strict(),
  measureFrame: z.object({ assetId: z.string().min(1), time: z.number().min(0).describe('SOURCE seconds.'), points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().max(60).optional() })).max(60).optional(), lines: z.array(z.object({ axis: z.enum(['x', 'y']), at: z.number(), from: z.number(), to: z.number(), label: z.string().max(60).optional() })).max(20).optional() }).strict().refine(input => (input.points?.length ?? 0) + (input.lines?.length ?? 0) > 0, { message: 'Measure at least one point or line.' }),
};
export const READ_TOOL_DESCRIPTIONS = {
  readFrames: 'See a video in the project (a reference you are recreating, or footage) as one image: frames from SOURCE start to end in a numbered grid labeled with the source second and how much each changed from the one before. Returns moments: every place in the window where the picture changes (start, end, strength, the region that moves, and cut or motion), measured from all frames at 10 fps, so you know where the action is. Read coarse to fine: the whole video with count 16 to get the frames and the moments; then each moment with fps 10 over its start to end (padded a little, up to 3 s), to see what slides, scales, blurs and how it eases, frame by frame; then crop to read small type and icons. A transition read with only a frame before and after is a guess. Use trackReference to measure a move and measureFrame for exact colors and edges.',
  trackReference: 'Measure how one object moves in a video: give a box around it in the frame at SOURCE start (read the box off a readFrames sheet) and an end. Returns moves: each move fitted as a GSAP tween (start, duration, from/to box center in source pixels, scale and rotation, and the GSAP ease whose curve matches the measured motion, with a fit score from 0 to 1 that combines how well the ease matches and how confidently the object was tracked, and a ready tl.fromTo line; below about 0.6 retrack with a tighter box or a shorter window), plus every frame\'s box, scale and rotation with a confidence (below about 0.5 the object was lost), and a sheet with the box drawn. Scale positions from source pixels to your scene size, and use these moves instead of guessing timings or eases.',
  measureFrame: 'Read exact pixels from one frame of a video, at full resolution: the hex color at points, and where the color changes along horizontal (axis y: a row at y=at, from x..to x) or vertical (axis x: a column at x=at) lines, which gives the edges and sizes of panels, buttons, type and gaps (only the clear edges that stand out along the line, not every grain of texture). Use it on a reference before rebuilding a shot; never type colors or sizes by eye.',
} as const;
export type ReadToolName = keyof typeof READ_TOOL_INPUTS;
type ReadResult = Infer<typeof referenceReadResult>;

export const request = internalMutation({ args: { ownerId: v.string(), projectId: v.id('projects'), assetId: v.string(), mode: v.union(v.literal('sheet'), v.literal('track'), v.literal('measure')), start: v.number(), end: v.number(), count: v.optional(v.number()), fps: v.optional(v.number()), crop: v.optional(referenceBox), box: v.optional(referenceBox), points: v.optional(v.array(blueprintPointValidator)), lines: v.optional(v.array(blueprintLineValidator)) }, returns: v.id('referenceReads'), handler: async (ctx, { ownerId, projectId, assetId: rawAssetId, ...args }) => {
  await requireEditorAccess(ctx, ownerId);
  const project = await requireProject(ctx, projectId, ownerId, false);
  const assetId = ctx.db.normalizeId('assets', rawAssetId), asset = assetId ? await ctx.db.get(assetId) : null;
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== project._id) throw new ConvexError('That media is not in this project. Use an assetId from getProject.');
  if (asset.kind !== 'video') throw new ConvexError('Only videos can be read frame by frame.');
  const duration = asset.duration ?? Infinity;
  if (args.start > duration || args.end < args.start) throw new ConvexError(`Choose a window inside the video (0 to ${Math.round(duration * 100) / 100} source seconds).`);
  await requireMediaTaskCapacity(ctx, ownerId, 1);
  const readId = await ctx.db.insert('referenceReads', { projectId: project._id, ownerId, assetId: asset._id, ...args, status: 'queued', createdAt: Date.now() });
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, kind: 'read', assetId: asset._id, readId });
  await ctx.db.patch(readId, { taskId });
  // Readings are returned once; anything unread is removed shortly after.
  await ctx.scheduler.runAfter(10 * 60_000, internal.referenceReads.discard, { readId });
  return readId;
}});

export const get = internalQuery({ args: { ownerId: v.string(), readId: v.id('referenceReads') }, returns: v.any(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (!read || read.ownerId !== args.ownerId) throw new ConvexError('Frame reading not found.');
  return { status: read.status, ...(read.error ? { error: read.error } : {}), ...(read.result ? { result: read.result } : {}) };
}});

export const discard = internalMutation({ args: { readId: v.id('referenceReads') }, returns: v.null(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (read) await ctx.db.delete(read._id);
  return null;
}});

/** Queue a reading for a read tool's input and wait for the worker; the result carries the sheet image when there is one. */
export async function runRead(ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, name: ReadToolName, input: object, signal?: AbortSignal): Promise<ReadResult> {
  const mode = name === 'readFrames' ? 'sheet' : name === 'trackReference' ? 'track' : 'measure';
  const { assetId, time, ...rest } = READ_TOOL_INPUTS[name].parse(input) as { assetId: string; time?: number; start?: number; end?: number };
  const start = time ?? rest.start!, end = time ?? rest.end!;
  const readId = await ctx.runMutation(internal.referenceReads.request, { ownerId, projectId, assetId, mode, ...rest, start, end });
  // A reading queued behind other work waits for its turn rather than failing; the worker takes readings first.
  const deadline = Date.now() + 540_000;
  let started = false;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Stopped.');
      const state = await ctx.runQuery(internal.referenceReads.get, { ownerId, readId });
      if (state.status !== 'queued') started = true;
      if (state.status === 'failed') throw new Error(`The frames could not be read: ${state.error ?? 'unknown error'}`);
      if (state.status === 'completed') return state.result as ReadResult;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    // Say which wait it was: a read that never started was stuck behind other media work, not too big.
    throw new Error(started ? 'Reading frames took too long. Try a shorter window or fewer frames.' : 'This read never started: the media worker stayed busy with other jobs for 9 minutes. Try again shortly; the window and frame count were not the problem.');
  } finally { await ctx.runMutation(internal.referenceReads.discard, { readId }); }
}

/** What the model reads besides the image: the numbers, without the image data. */
export function readSummary(name: ReadToolName, result: ReadResult) {
  const { image: _image, ...rest } = result;
  const moments = result.moments ?? [];
  const note = name === 'readFrames' ? `Sheet of ${result.frames.length} frames (${result.width}x${result.height}), in order left to right, top to bottom. Source is ${result.sourceWidth}x${result.sourceHeight} at ${result.fps} fps; boxes are source pixels.${moments.length ? ` ${moments.length} moments where the picture changes: ${moments.map(m => `${m.start}-${m.end}s ${m.kind}`).join(', ')}. Read each one you have not yet seen frame by frame with fps 10 (start a little before it, end a little after, up to 3 s) before rebuilding it.` : ' No changes in this window: it is a hold; note its length.'}` : name === 'trackReference' ? `Tracked ${result.track?.length ?? 0} frames; the sheet shows ${result.frames.length} of them with the box drawn. Boxes are source pixels.` : `Frame ${result.width}x${result.height}.`;
  return { note, ...rest };
}
