import type { FrameCache } from './frame-cache';
import sharp from 'sharp';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { cropBounds, referenceCropAt } from '@/lib/ai/reference-comparison';
import { frameAt, imageSource, probe, sheet } from './read-reference';

type Work = NonNullable<MediaWorkItem['read']>;
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** How different two pictures are, 0 (the same) to 1. Most of a motion frame is plain background, so a whole-frame
 * average says "nearly identical" while the keys sit in the wrong place: compare the content instead. Each frame's
 * content is what stands off its own background; part of the score is how little the two contents overlap (position,
 * size, shape), with color differences over content and the background. Crop small details for an independent score. */
async function difference(a: Buffer, b: Buffer) {
  const meta = await sharp(a).metadata(), width = Math.min(640, meta.width ?? 640), height = Math.max(1, Math.round(width * (meta.height ?? 360) / (meta.width ?? 640)));
  const small = (image: Buffer) => sharp(image).resize(width, height, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const [x, y] = await Promise.all([small(a), small(b)]);
  const content = (pixels: Buffer) => {
    // The background is the most common color: the median of each channel over the frame.
    const median = [0, 1, 2].map(channel => { const values: number[] = []; for (let index = channel; index < pixels.length; index += 3) values.push(pixels[index]); values.sort((p, q) => p - q); return values[values.length >> 1]; });
    const mask = new Uint8Array(pixels.length / 3);
    for (let pixel = 0; pixel < mask.length; pixel++) mask[pixel] = Math.abs(pixels[pixel * 3] - median[0]) + Math.abs(pixels[pixel * 3 + 1] - median[1]) + Math.abs(pixels[pixel * 3 + 2] - median[2]) > 60 ? 1 : 0;
    return mask;
  };
  const [first, second] = [content(x), content(y)];
  let both = 0, either = 0, colors = 0, allColors = 0;
  for (let pixel = 0; pixel < first.length; pixel++) {
    const delta = (Math.abs(x[pixel * 3] - y[pixel * 3]) + Math.abs(x[pixel * 3 + 1] - y[pixel * 3 + 1]) + Math.abs(x[pixel * 3 + 2] - y[pixel * 3 + 2])) / (3 * 255);
    allColors += delta;
    if (!first[pixel] && !second[pixel]) continue;
    either++; if (first[pixel] && second[pixel]) both++;
    colors += delta;
  }
  const background = allColors / first.length;
  if (!either) return background;
  return .4 * (1 - both / either) + .4 * colors / either + .2 * background;
}

/** The reference beside the recreation at the same moments, each pair labeled with how far apart it is. */
export async function readCompare(path: string, directory: string, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, stillImage = false, cache?: FrameCache): Promise<NonNullable<MediaTaskResult['read']>> {
  const rendered = work.rendered ?? [], times = work.times ?? rendered.map(frame => frame.time);
  if (!rendered.length || rendered.length !== times.length) throw new AnalysisError('There are no timeline frames to compare with.', 400);
  const still = stillImage ? await imageSource(path) : undefined;
  const source = still ?? await probe(path, signal, cache), last = source.fps ? Math.max(0, source.duration - 1 / source.fps) : 0;
  const tiles: { image: Buffer; label: string }[] = [], scores: { time: number; difference: number }[] = [];
  for (const [index, time] of times.entries()) {
    signal.throwIfAborted();
    const full = still?.image ?? await frameAt(path, directory, Math.min(Math.max(0, time), last), undefined, `compare-${index}`, signal, cache);
    const crop = referenceCropAt(time, work.compareCrop, work.referenceCropKeyframes);
    const reference = crop ? await sharp(full).extract(cropBounds(crop, source.width, source.height)).png().toBuffer() : full;
    // Comparison snapshots crop the render before compression; the reference is cropped here on its displayed axes.
    const meta = await sharp(reference).metadata();
    const yours = await sharp(Buffer.from(rendered[index].image, 'base64')).resize(meta.width!, meta.height!, { fit: 'fill' }).png().toBuffer();
    const score = round(await difference(reference, yours));
    scores.push({ time: round(time), difference: score });
    // Pairs sit side by side: the sheet lays out an even number of columns, so a reference and its render share a row.
    tiles.push({ image: reference, label: `${index + 1}  ${time.toFixed(2)}s  reference` }, { image: yours, label: `${index + 1}  yours  diff ${Math.round(score * 100)}%` });
    onProgress(10 + Math.round(70 * (index + 1) / times.length));
  }
  // Big enough to compare type and edges: each moment is one row, the reference and yours side by side at half the
  // sheet's width, three moments to an image.
  const sheets = [];
  // The sheets travel in one stored result, so they share one image budget.
  const count = Math.ceil(tiles.length / 6), budget = Math.floor(880_000 / count);
  const firstCrop = referenceCropAt(times[0], work.compareCrop, work.referenceCropKeyframes);
  for (let first = 0; first < tiles.length; first += 6) sheets.push(await sheet(tiles.slice(first, first + 6), (firstCrop ? source.width * firstCrop.w / (source.height * firstCrop.h) : source.width / source.height), 2, budget));
  return { ...sheets[0], ...(sheets.length > 1 ? { extraImages: sheets.slice(1).map(item => item.image) } : {}), sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps), frames: times.map(time => ({ time: round(time) })), scores };
}
