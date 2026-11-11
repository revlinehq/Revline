import { ConvexError, type Infer } from 'convex/values';
import { z } from 'zod';
import { parse } from 'convex-helpers/validators';
import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { referenceReadResult } from '../schema';
import { LOOKS_OFF, type LookSample } from '../../lib/ai/eyes';
import { processorCan } from './processor_capabilities';

// Reading a source video for an agent: the worker cuts frames into one labeled sheet image the model looks at.
// Times and boxes are SOURCE seconds and pixels.

const box = z.object({ x: z.number().min(0), y: z.number().min(0), w: z.number().positive(), h: z.number().positive() });
const window = { assetId: z.string().min(1), start: z.number().min(0).describe('SOURCE seconds.'), end: z.number().min(0).describe('SOURCE seconds.') };
export const READ_TOOL_INPUTS = {
  readFrames: z.object({ ...window, checkId: z.string().min(1).optional().describe("Resume the saved source read using exactly the original arguments from nextAction."), times:z.array(z.number().nonnegative()).min(1).max(30).optional().describe('Explicit SOURCE seconds instead of evenly spaced count. Batch up to 12 sparse stills across shortlisted clipping candidates; set start/end to the first/last time and stillsOnly:true.'), count: z.number().int().min(1).max(30).optional().describe('Frames spread evenly from start to end (default 8, up to 30).'), fps: z.number().min(1).max(120).optional().describe('Consecutive source frames at this rate, up to 30 per call. Shorten each window to fit 30 frames.'), stillsOnly: z.boolean().optional().describe('Return only the requested still frames; skip the automatic 10 fps motion map. Use true for clipping context and framing.'), momentsOnly: z.boolean().optional().describe('Return only the map, no image: every moment (up to 80) and every hold (a second or more where the picture all but stops) from start to end. Cheap on any length, so read a long clip whole this way first.'), crop: box.optional().describe('Zoom into this part of the frame, in source pixels, to read small type, icons and edges.') }).strict(),
};
export const READ_TOOL_DESCRIPTIONS = {
  readFrames: 'Clipping: batch up to 12 explicit SOURCE times across shortlisted candidates in one call with times:[...], start/end at the first/last time and stillsOnly:true; this skips motion analysis. Reuse those frames; count:2 or 3 over one candidate is for unresolved framing only. Read a project image with start: 0, end: 0, count: 1, optionally crop; images have no motion. Or see a video in the project as one image: frames from SOURCE start to end in a numbered grid labeled with the source second and how much each changed from the one before. Returns moments: every place in the window where the picture changes (start, end, strength, the region that moves, and cut or motion), measured from all frames at 10 fps, so you know where the action is. Read coarse to fine: the whole video with count 16 to get the frames and the moments; then each moment with fps 15 over its start to end (padded a little, up to 30 frames; continue with the next window), to see what slides, scales, blurs and how it eases, frame by frame; then crop to read small type and icons. For a close look, open one full-size frame (count 1, start at that moment) or a crop. Footage (a talking head, vlog or podcast): read the transcript and make the speech cut first; frames then confirm a flagged edge or a visual cue in a narrow window around its transcript time. Only for a visually motivated cut the user asked for, momentsOnly over the whole clip maps where something happens (a look away, a reach for the camera, a jump) and holds (frozen stretches); then fps 15 over each candidate shows it frame by frame. In clipping, fps reads are allowed only after planClips accepts candidates, and only for framing: at most 1 second and 30 frames. When momentsOnly returns the 80-moment cap, read the rest of the window again from the last returned time until all source time is covered.',
} as const;
export type ReadToolName = keyof typeof READ_TOOL_INPUTS;
type ReadResult = Infer<typeof referenceReadResult>;

type PendingFrames = { status: 'pending'; checkId: string; nextAction: { tool: 'readFrames'; arguments: Record<string, unknown> }; note: string };

async function runSourceFrames(ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, input: object, signal?: AbortSignal): Promise<ReadResult | PendingFrames> {
  const deadline = Date.now() + 45_000;
  const { checkId, assetId, ...work } = READ_TOOL_INPUTS.readFrames.parse(input);
  let readId = checkId ? await ctx.runQuery(internal.referenceReads.resumeFrames, { ownerId, projectId, checkId, input }) : undefined;
  if (!readId) {
    const cached = await ctx.runAction(internal.frameCache.readResult, { ownerId, projectId, assetId, work: { mode: 'sheet', ...work } });
    if (cached) return parse(referenceReadResult, cached);
    for (let attempt = 0; !readId; attempt++) {
      if (signal?.aborted) throw new Error('Stopped.');
      try { readId = await ctx.runMutation(internal.referenceReads.request, { ownerId, projectId, assetId, mode: 'sheet', ...work }); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (Date.now() + 2000 >= deadline || (!/too many media jobs processing/i.test(message) && !(attempt < 5 && /changed while this mutation was being run/i.test(message)))) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Stopped.');
    const state = await ctx.runQuery(internal.referenceReads.get, { ownerId, readId });
    if (state.status === 'failed') {
      await ctx.runMutation(internal.referenceReads.discard, { readId });
      throwReadFailure(state.error, 'The frames could not be read');
    }
    if (state.status === 'completed') {
      // Poll without taking: validation and file retrieval must succeed before cleanup.
      try {
        const result = parse(referenceReadResult, state.resultStorageId ? await ctx.runAction(internal.mediaTaskResults.consumeRead, { ownerId, readId, retain: true, deadline }) : state.result);
        await ctx.runMutation(internal.referenceReads.discard, { readId });
        return result;
      } catch (error) {
        const data = (error as { data?: { code?: string } })?.data;
        if (data?.code === 'REFERENCE_READ_DOWNLOAD_RETRY') break;
        await ctx.runMutation(internal.referenceReads.discard, { readId });
        throw error;
      }
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(1500, Math.max(0, deadline - Date.now()))));
  }
  return { status: 'pending', checkId: readId, nextAction: { tool: 'readFrames', arguments: { projectId, assetId, ...work, checkId: readId } }, note: 'The saved source read keeps running. Follow nextAction with the original arguments to retrieve it; no new job is started. The check expires 10 minutes after creation.' };
}

function throwReadFailure(error: string | undefined, prefix: string): never {
  if (error?.startsWith('Still queued after')) throw new ConvexError({ status: 'still_queued', retryAfterSeconds: 30, message: error });
  throw new Error(`${prefix}: ${error ?? 'unknown error'}`);
}

/** Queue a source-frame reading and wait for the worker; the result carries the sheet image when there is one. */
export const runRead = (ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, _name: ReadToolName, input: object, signal?: AbortSignal): Promise<ReadResult | PendingFrames> => runSourceFrames(ctx, ownerId, projectId, input, signal);

/** The looks read produced no measurement: switched off, or a processor that does not have it. Callers warn; nothing fails. */
export class LooksUnavailableError extends Error {}

/** The shared eyes read on the media worker. Without `strip`: measured face signals at these SOURCE times.
 * With `strip`: the same frames as strips of that many frames side by side (base64 JPEG each), for the model to look at. */
export async function runLooksRead(ctx: ActionCtx, ownerId: string, projectId: Id<'projects'>, assetId: string, times: number[], strip?: number, signal?: AbortSignal): Promise<{ samples: LookSample[]; strips: string[] }> {
  const sorted = strip ? times : [...new Set(times)].sort((a, b) => a - b), work = { mode: 'looks' as const, start: Math.min(...sorted), end: Math.max(...sorted), times: sorted, ...(strip ? { count: strip } : {}) };
  // A processor from before the looks read answers with an ordinary frame sheet: completed, but with no face samples
  // and no strips. That is "cannot measure", never "measured and clean".
  const measured = (result: ReadResult | null | undefined) => !!result && (strip ? !!result.extraImages?.length : Array.isArray(result.looks) && result.looks.length > 0);
  const read = (result: ReadResult) => {
    if (!measured(result)) throw new LooksUnavailableError('The media processor on this server cannot measure faces yet.');
    return { samples: (result.looks ?? []) as LookSample[], strips: result.extraImages ?? [] };
  };
  const cached = await ctx.runAction(internal.frameCache.readResult, { ownerId, projectId, assetId, work }) as ReadResult | null;
  if (measured(cached)) return read(cached!);
  // Ask before queuing: a processor that reported without the looks read would only return an empty "success".
  // A processor that has never reported (an image from before reporting) may or may not have it, so the read is
  // queued and measured() decides, as before; it is also the fallback for a stale report (mixed fleet, rollback).
  if (!await processorCan(ctx, 'read:looks', { whenUnreported: true })) throw new LooksUnavailableError('The media processor on this server cannot measure faces yet.');
  let readId: Id<'referenceReads'>;
  try { readId = await ctx.runMutation(internal.referenceReads.request, { ownerId, projectId, assetId, ...work }); }
  catch (error) { if (error instanceof Error && error.message.includes(LOOKS_OFF)) throw new LooksUnavailableError(LOOKS_OFF); throw error; }
  const deadline = Date.now() + 420_000;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Stopped.');
      const state = await ctx.runMutation(internal.referenceReads.take, { ownerId, readId });
      if (state.status === 'failed') throwReadFailure(state.error, 'The frames could not be measured');
      if (state.status === 'completed') return read((state.resultStorageId ? await ctx.runAction(internal.mediaTaskResults.consumeRead, { ownerId, readId }) : state.result) as ReadResult);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    throw new Error('Measuring the frames took too long.');
  } finally { await ctx.runMutation(internal.referenceReads.discard, { readId }); }
}

/** What the model reads besides the image: the numbers, without the image data. */
export function readSummary(name: ReadToolName, result: ReadResult) {
  const { image: _image, ...rest } = result;
  const moments = result.moments ?? [];
  const holds = result.holds ?? [];
  const note = name === 'readFrames' && result.fps === 0 ? `Still image (${result.sourceWidth}x${result.sourceHeight}). No motion is measured.` : name === 'readFrames' && !result.image ? `Map only, no image. ${moments.length} moments (${moments.map(m => `${m.start}-${m.end}s ${m.kind}`).join(', ') || 'none'}) and ${holds.length} holds (${holds.map(h => `${h.start}-${h.end}s`).join(', ') || 'none'}). Read each candidate with fps 15 before cutting it.` : name === 'readFrames' ? `Sheet of ${result.frames.length} frames (${result.width}x${result.height}), in order left to right, top to bottom. Source is ${result.sourceWidth}x${result.sourceHeight} at ${result.fps} fps; boxes are source pixels.${moments.length ? ` ${moments.length} moments where the picture changes: ${moments.map(m => `${m.start}-${m.end}s ${m.kind}`).join(', ')}. Read each one you need frame by frame with fps 15 (start a little before it, end a little after, up to 3 s).` : result.frames.some(frame => (frame.change ?? 0) >= .01) ? ` No strong moment measured, but the frames differ (up to ${Math.round(Math.max(...result.frames.map(frame => frame.change ?? 0)) * 100)}% between frames): something small or slow moves here, so read the sheet frame by frame; it is not a hold.` : ' No changes in this window: it is a hold; note its length.'}` : `Frame ${result.width}x${result.height}.`;
  return { note, ...rest };
}
