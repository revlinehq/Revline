import { comparisonCrop, referenceCropKeyframes, type ComparisonCrop, type ReferenceCropKeyframe } from '../lib/ai/reference-comparison';
import { MEDIA_PROCESSOR_VERSION } from '../lib/media-analysis/processor-version';
import { ConvexError, v, type Infer } from 'convex/values';
import { z } from 'zod';
import { internalMutation, internalQuery, type ActionCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireProject } from './lib/auth';
import { requireEditorAccess } from './lib/billing_access';
import { requireMediaTaskCapacity } from './lib/account_limits';
import { cancelMediaTask, enqueueMediaTask, RECREATION_PROCESSOR_VERSION, REFERENCE_CROP_PROCESSOR_VERSION } from './mediaTasks';
import type { MotionMap } from '../lib/inspo-motion/motion-map';
import { blueprintLineValidator, blueprintPointValidator, referenceBox, referenceReadResult, referenceCropKeyframesValidator } from './schema';

// Reading a source video for an agent: the worker cuts frames into one labeled sheet image the model looks at,
// follows a boxed object frame by frame, or reads exact pixels of one frame. Times and boxes are SOURCE seconds and pixels.

const box = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() });
const window = { assetId: z.string().min(1), start: z.number().min(0).describe('SOURCE seconds.'), end: z.number().min(0).describe('SOURCE seconds.') };
export const READ_TOOL_INPUTS = {
  readFrames: z.object({ ...window, count: z.number().int().min(1).max(30).optional().describe('Frames spread evenly from start to end (default 8, up to 30).'), fps: z.number().min(1).max(30).optional().describe('Read consecutive moments instead: frames at this rate from start (10 to 15 for a transition), up to 30 frames, so a 1.5 to 3 s window shows the motion itself.'), momentsOnly: z.boolean().optional().describe('Return only the map, no image: every moment (up to 80) and every hold (a second or more where the picture all but stops) from start to end. Cheap on any length, so read a long clip whole this way first.'), crop: box.optional().describe('Zoom into this part of the frame, in source pixels, to read small type, icons and edges.') }).strict(),
  listenReference: z.object({ ...window }).strict(),
  trackReference: z.object({ ...window, box: box.describe('The object in the frame at start, in source pixels (from a readFrames sheet).') }).strict(),
  measureFrame: z.object({ assetId: z.string().min(1), time: z.number().min(0).describe('SOURCE seconds.'), points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().max(60).optional() })).max(60).optional(), lines: z.array(z.object({ axis: z.enum(['x', 'y']), at: z.number(), from: z.number(), to: z.number(), label: z.string().max(60).optional() })).max(20).optional() }).strict().refine(input => (input.points?.length ?? 0) + (input.lines?.length ?? 0) > 0, { message: 'Measure at least one point or line.' }),
  matchFont: z.object({ assetId: z.string().min(1), time: z.number().min(0).describe('SOURCE seconds.'), crop: box.describe('Around one run of text in one typeface, in source pixels, with a little background on every side and no other type in it (from a readFrames crop).'), text: z.string().trim().min(1).max(120).describe('The text in the crop exactly as it reads, letter for letter and in its case; separate lines with \\n.'), categories: z.array(z.enum(['serif', 'sans', 'mono', 'handwritten', 'display'])).max(5).optional().describe('Which kinds of type to try (default all). Narrowing to what you see is faster.') }).strict(),
  traceShape: z.object({ assetId: z.string().min(1), time: z.number().min(0).describe('SOURCE seconds.'), box: box.describe('Around the one shape to trace, in source pixels, with a little background on every side (from a readFrames crop).'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe("The shape's color from measureFrame, when the box holds more than one color that stands out."), tolerance: z.number().min(4).max(160).optional().describe('How far a pixel may be from that color and still be the shape (default: measured from the frame).') }).strict(),
};
export const READ_TOOL_DESCRIPTIONS = {
  listenReference: 'Hear a reference video\'s sound design, SOURCE start to end (up to 60 s): every sound effect\'s measured onset, end and level in dB, the picture change it lands on (hit, measured at 30 fps), what it sounds like and a prompt to regenerate it (kind, description, prompt, onScreen), the music bed, and silentHits (picture changes with no sound). Use it when recreating a reference, after readFrames maps its moments: for each moment your film reuses, generate that sound with generateSound from its prompt and length, place it on your matching frame, then run checkSound. Never copy the reference audio itself.',
  readFrames: 'Read a project image with start: 0, end: 0, count: 1, optionally crop; images have no motion. Or see a video in the project (a reference you are recreating, or footage) as one image: frames from SOURCE start to end in a numbered grid labeled with the source second and how much each changed from the one before. Returns moments: every place in the window where the picture changes (start, end, strength, the region that moves, and cut or motion), measured from all frames at 10 fps, so you know where the action is. Read coarse to fine: the whole video with count 16 to get the frames and the moments; then each moment with fps 15 over its start to end (padded a little, up to 30 frames; continue with the next window), to see what slides, scales, blurs and how it eases, frame by frame; then crop to read small type and icons. Grids show how things move; for how they look (shapes, letter colors, textures), open one full-size frame (count 1, start at that moment) or a crop of each key moment before building it. A transition read with only a frame before and after is a guess. Footage (a talking head, vlog or podcast): momentsOnly over the whole clip maps where something happens (a look away, a reach for the camera, a jump) and holds (frozen stretches); then fps 15 over each candidate shows it frame by frame. Use trackReference to measure a move and measureFrame for exact colors and edges.',
  trackReference: 'Measure how one object moves in a video: give a box around it in the frame at SOURCE start (read the box off a readFrames sheet) and an end. Returns moves: each move fitted as a GSAP tween (start, duration, from/to box center in source pixels, scale and rotation, and the GSAP ease whose curve matches the measured motion, with a fit score from 0 to 1 that combines how well the ease matches and how confidently the object was tracked, and a ready tl.fromTo line; below about 0.6 retrack with a tighter box or a shorter window), plus every frame\'s box, scale and rotation with a confidence (below about 0.5 the object was lost), and a sheet with the box drawn. Scale positions from source pixels to your scene size, and use these moves instead of guessing timings or eases.',
  measureFrame: 'Read exact pixels from one frame of a video, at full resolution: the hex color at points, and where the color changes along horizontal (axis y: a row at y=at, from x..to x) or vertical (axis x: a column at x=at) lines, which gives the edges and sizes of panels, buttons, type and gaps (only the clear edges that stand out along the line, not every grain of texture). Use it on a reference before rebuilding a shot; never type colors or sizes by eye.',
  matchFont: 'Find the Google Font a piece of reference type is set in. Give the SOURCE time, a crop around one run of text in one typeface, and the text exactly as it reads. Renders the same words in a shortlist of Google Fonts (the most used per category plus families launch films lean on), compares each with the crop by outline, shape, width and stroke weight, refines the best families over their weights and italics, and returns the top 3 (family, weight, style, score 0 to 1) with one image: the crop above each candidate drawn in the crop\'s own colors. Look at the image and pick the one that matches; a score above about 0.75 is a close match, under 0.5 is only the nearest of the shortlist (handwriting scores lower). Load the pick in scenes the way brand fonts load: createBrandKit (or updateBrandKit) with fonts [{ family, role }] for the video\'s brand, attach it with brandKitId, and set font-family and font-weight in the scene.',
  traceShape: "Trace one hand-made shape in a video frame (a brush stroke or spiral, torn-paper edges, a blob, a hand-drawn mark, or a logo findIcon does not have) into SVG, so a scene shows and animates the real shape instead of a drawing by eye. Give the SOURCE time and a box around the shape in source pixels. Returns trace.svg (viewBox in the box's pixels: place it at box.x, box.y on a frame of the source's size, scaled like the frame), trace.paths (each d with its fill color, sampled from the pixels), the background it was separated from, coverage (the share of the box that is shape), and trace.centerline: the stroke's spine as one open path with its width, for drawing a stroke on (mask the shape with a path along centerline at that stroke-width and animate the mask path with DrawSVG from 0% to 100%). The image shows the crop beside the trace; if the trace took in background or missed parts, call again with color (the shape's hex from measureFrame), a tolerance, or a tighter box.",
} as const;
export type ReadToolName = keyof typeof READ_TOOL_INPUTS;
type ReadResult = Infer<typeof referenceReadResult>;

export const request = internalMutation({ args: { ownerId: v.string(), projectId: v.id('projects'), assetId: v.string(), mode: v.union(v.literal('sheet'), v.literal('track'), v.literal('measure'), v.literal('compare'), v.literal('trace'), v.literal('font'), v.literal('sounds'), v.literal('motion')), color: v.optional(v.string()), tolerance: v.optional(v.number()), text: v.optional(v.string()), categories: v.optional(v.array(v.string())), start: v.number(), end: v.number(), times: v.optional(v.array(v.number())), snapshotId: v.optional(v.id('frameSnapshots')), compareCrop: v.optional(referenceBox), referenceCropKeyframes: v.optional(referenceCropKeyframesValidator), count: v.optional(v.number()), fps: v.optional(v.number()), momentsOnly: v.optional(v.boolean()), crop: v.optional(referenceBox), box: v.optional(referenceBox), points: v.optional(v.array(blueprintPointValidator)), lines: v.optional(v.array(blueprintLineValidator)) }, returns: v.id('referenceReads'), handler: async (ctx, { ownerId, projectId, assetId: rawAssetId, ...args }) => {
  await requireEditorAccess(ctx, ownerId);
  const project = await requireProject(ctx, projectId, ownerId, false);
  const assetId = ctx.db.normalizeId('assets', rawAssetId), asset = assetId ? await ctx.db.get(assetId) : null;
  if (!asset || asset.ownerId !== ownerId || asset.projectId !== project._id) throw new ConvexError('That media is not in this project. Use an assetId from getProject.');
  const still = asset.kind === 'image';
  if (asset.kind !== 'video' && !still) throw new ConvexError('Choose a video or image reference from this project.');
  if (still && !['sheet', 'compare'].includes(args.mode)) throw new ConvexError('Still images support readFrames and compareReference; motion and sound need a video.');
  if (still && args.mode === 'sheet' && (args.start !== 0 || args.end !== 0 || args.fps !== undefined || args.momentsOnly || (args.count ?? 1) !== 1)) throw new ConvexError('Read a still image with start: 0, end: 0, count: 1; it has no moving frames.');
  const duration = still ? Infinity : asset.duration ?? Infinity;
  if (args.start > duration || args.end < args.start) throw new ConvexError(`Choose a window inside the video (0 to ${Math.round(duration * 100) / 100} source seconds).`);
  if (args.compareCrop) comparisonCrop.parse(args.compareCrop);
  if (args.referenceCropKeyframes) referenceCropKeyframes.parse(args.referenceCropKeyframes);
  await requireMediaTaskCapacity(ctx, ownerId, 1);
  const readId = await ctx.db.insert('referenceReads', { projectId: project._id, ownerId, assetId: asset._id, ...args, status: 'queued', createdAt: Date.now() });
  const taskId = await enqueueMediaTask(ctx, { ownerId, projectId: project._id, kind: 'read', assetId: asset._id, readId, requiredProcessorVersion: still ? MEDIA_PROCESSOR_VERSION : args.referenceCropKeyframes ? REFERENCE_CROP_PROCESSOR_VERSION : RECREATION_PROCESSOR_VERSION });
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

/** get, deleting a finished or failed reading as it is read, so its images are read once instead of again by discard. */
export const take = internalMutation({ args: { ownerId: v.string(), readId: v.id('referenceReads') }, returns: v.any(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (!read || read.ownerId !== args.ownerId) throw new ConvexError('Frame reading not found.');
  if (read.status !== 'queued') await ctx.db.delete(read._id);
  return { status: read.status, ...(read.error ? { error: read.error } : {}), ...(read.result ? { result: read.result } : {}) };
}});

export const discard = internalMutation({ args: { readId: v.id('referenceReads') }, returns: v.null(), handler: async (ctx, args) => {
  const read = await ctx.db.get(args.readId);
  if (read?.mode === 'compare' && read.status === 'queued' && read.taskId) await cancelMediaTask(ctx, read.taskId);
  if (read) await ctx.db.delete(read._id);
  return null;
}});

/** Queue a reading for a read tool's input and wait for the worker; the result carries the sheet image when there is one. */
export async function runRead(ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, name: ReadToolName, input: object, signal?: AbortSignal): Promise<ReadResult> {
  const mode = name === 'listenReference' ? 'sounds' : name === 'readFrames' ? 'sheet' : name === 'trackReference' ? 'track' : name === 'traceShape' ? 'trace' : name === 'matchFont' ? 'font' : 'measure';
  const { assetId, time, ...rest } = READ_TOOL_INPUTS[name].parse(input) as { assetId: string; time?: number; start?: number; end?: number };
  const start = time ?? rest.start!, end = time ?? rest.end!;
  // Many reads started at once contend with the worker claiming and heartbeating media tasks; a write conflict is retried, not returned.
  // A full account queue (other edits' renders) frees up in seconds: wait for a slot instead of failing the read.
  let readId: Id<'referenceReads'> | undefined;
  const queueDeadline = Date.now() + 120_000;
  for (let attempt = 0; !readId; attempt++) {
    try { readId = await ctx.runMutation(internal.referenceReads.request, { ownerId, projectId, assetId, mode, ...rest, start, end }); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/too many media jobs processing/i.test(message) && Date.now() < queueDeadline && !signal?.aborted) { await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000)); continue; }
      if (attempt >= 5 || !/changed while this mutation was being run/i.test(message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt + Math.random() * 300));
    }
  }
  // A reading queued behind other work waits for its turn rather than failing; the worker takes readings first.
  const deadline = Date.now() + 540_000;
  let started = false;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Stopped.');
      const state = await ctx.runMutation(internal.referenceReads.take, { ownerId, readId });
      if (state.status !== 'queued') started = true;
      if (state.status === 'failed') throw new Error(`The frames could not be read: ${state.error ?? 'unknown error'}`);
      if (state.status === 'completed') return state.result as ReadResult;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    // Say which wait it was: a read that never started was stuck behind other media work, not too big.
    throw new Error(started ? 'Reading frames took too long. Try a shorter window or fewer frames.' : 'This read never started: the media worker stayed busy with other jobs for 9 minutes. Try again shortly; the window and frame count were not the problem.');
  } finally { await ctx.runMutation(internal.referenceReads.discard, { readId }); }
}

/** How a reference video moves over SOURCE start to end (motionMap), read on the media worker. */
export async function runMotionRead(ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, assetId: string, start: number, end: number, signal?: AbortSignal, compareCrop?: ComparisonCrop, cropKeyframes?: ReferenceCropKeyframe[]): Promise<MotionMap> {
  const readId = await ctx.runMutation(internal.referenceReads.request, { ownerId, projectId, assetId, mode: 'motion', start, end, ...(compareCrop ? { compareCrop } : {}), ...(cropKeyframes ? { referenceCropKeyframes: cropKeyframes } : {}) });
  const deadline = Date.now() + 300_000;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Stopped.');
      const state = await ctx.runMutation(internal.referenceReads.take, { ownerId, readId });
      if (state.status === 'failed') throw new Error(`The motion map could not read the reference: ${state.error ?? 'unknown error'}`);
      if (state.status === 'completed') return (state.result as ReadResult).motion as MotionMap;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('Reading the motion took too long. Map a shorter window.');
  } finally { await ctx.runMutation(internal.referenceReads.discard, { readId }); }
}

/** What the model reads besides the image: the numbers, without the image data. */
export function readSummary(name: ReadToolName, result: ReadResult) {
  const { image: _image, ...rest } = result;
  const moments = result.moments ?? [];
  const holds = result.holds ?? [];
  if (name === 'listenReference') return { note: `${result.sounds?.length ?? 0} sounds${result.music?.present ? ', with music' : ''}. ${result.sounds?.length && !result.sounds.some(sound => sound.prompt) ? ' They could not be described this time (timing and levels are measured): use readFrames on each onset to see what it accompanies.' : ''} Each is placed by its measured onset; regenerate it with generateSound from its prompt and length, on your matching frame.`, ...rest };
  const note = name === 'readFrames' && result.fps === 0 ? `Still image reference (${result.sourceWidth}x${result.sourceHeight}). Read its composition, palette, hierarchy and material intent. No motion is measured.` : name === 'readFrames' && !result.image ? `Map only, no image. ${moments.length} moments (${moments.map(m => `${m.start}-${m.end}s ${m.kind}`).join(', ') || 'none'}) and ${holds.length} holds (${holds.map(h => `${h.start}-${h.end}s`).join(', ') || 'none'}). Read each candidate with fps 15 before cutting it.` : name === 'readFrames' ? `Sheet of ${result.frames.length} frames (${result.width}x${result.height}), in order left to right, top to bottom. Source is ${result.sourceWidth}x${result.sourceHeight} at ${result.fps} fps; boxes are source pixels.${moments.length ? ` ${moments.length} moments where the picture changes: ${moments.map(m => `${m.start}-${m.end}s ${m.kind}`).join(', ')}. Read each one you have not yet seen frame by frame with fps 15 (start a little before it, end a little after, up to 3 s) before rebuilding it.` : result.frames.some(frame => (frame.change ?? 0) >= .01) ? ` No strong moment measured, but the frames differ (up to ${Math.round(Math.max(...result.frames.map(frame => frame.change ?? 0)) * 100)}% between frames): something small or slow moves here, so read the sheet frame by frame; it is not a hold.` : ' No changes in this window: it is a hold; note its length.'}` : name === 'trackReference' ? `Tracked ${result.track?.length ?? 0} frames; the sheet shows ${result.frames.length} of them with the box drawn. Boxes are source pixels.` : name === 'matchFont' ? `Closest Google Fonts: ${(result.fonts ?? []).map((font, index) => `${index + 1}. ${font.family} ${font.weight}${font.style === 'italic' ? ' italic' : ''} (${font.score})`).join(', ') || 'none'}. Ink ${result.fontColors?.ink ?? '?'} on ${result.fontColors?.background ?? '?'}. The image is the crop on top, then each candidate drawn with the same words; pick the one whose letter shapes match, not only the top score.` : name === 'traceShape' ? `Traced ${result.trace?.paths.length ?? 0} paths in ${result.trace?.color ?? 'the shape color'} over ${result.trace?.background ?? 'the background'}, ${Math.round((result.trace?.coverage ?? 0) * 100)}% of the box. The image is the crop (left) beside the trace (right).` : `Frame ${result.width}x${result.height}.`;
  return { note, ...rest };
}

/** The reference beside the timeline at the same moments: snapshotId holds the timeline frames already rendered at
 * those moments (plus any offset), times are the reference's seconds. One grid image, a difference score per moment. */
export async function runCompare(ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, assetId: string, times: number[], snapshotId: Id<'frameSnapshots'>, deadline: number, signal?: AbortSignal, compareCrop?: ComparisonCrop, cropKeyframes?: ReferenceCropKeyframe[]): Promise<ReadResult | null> {
  if (Date.now() >= deadline) return null;
  const readId = await ctx.runMutation(internal.referenceReads.request, { ownerId, projectId, assetId, mode: 'compare', start: Math.min(...times), end: Math.max(...times), times, snapshotId, ...(compareCrop ? { compareCrop } : {}), ...(cropKeyframes ? { referenceCropKeyframes: cropKeyframes } : {}) });
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Stopped.');
      const state = await ctx.runMutation(internal.referenceReads.take, { ownerId, readId });
      if (state.status === 'failed') throw new Error(`The comparison could not be made: ${state.error ?? 'unknown error'}`);
      if (state.status === 'completed') return state.result as ReadResult;
      await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(1500, deadline - Date.now()))));
    }
    return null;
  } finally { await ctx.runMutation(internal.referenceReads.discard, { readId }); }
}
