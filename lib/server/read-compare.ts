import sharp from 'sharp';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { frameAt, probe, sheet } from './read-reference';

type Work = NonNullable<MediaWorkItem['read']>;
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** How different two pictures are, 0 (the same) to 1. Most of a motion frame is plain background, so a whole-frame
 * average says "nearly identical" while the keys sit in the wrong place: compare the content instead. Each frame's
 * content is what stands off its own background; half the score is how little the two contents overlap (position,
 * size, shape), half is how far their colors are apart where either has content. */
async function difference(a: Buffer, b: Buffer) {
  const small = (image: Buffer) => sharp(image).resize(96, 54, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const [x, y] = await Promise.all([small(a), small(b)]);
  const content = (pixels: Buffer) => {
    // The background is the most common color: the median of each channel over the frame.
    const median = [0, 1, 2].map(channel => { const values: number[] = []; for (let index = channel; index < pixels.length; index += 3) values.push(pixels[index]); values.sort((p, q) => p - q); return values[values.length >> 1]; });
    const mask = new Uint8Array(pixels.length / 3);
    for (let pixel = 0; pixel < mask.length; pixel++) mask[pixel] = Math.abs(pixels[pixel * 3] - median[0]) + Math.abs(pixels[pixel * 3 + 1] - median[1]) + Math.abs(pixels[pixel * 3 + 2] - median[2]) > 60 ? 1 : 0;
    return mask;
  };
  const [first, second] = [content(x), content(y)];
  let both = 0, either = 0, colors = 0;
  for (let pixel = 0; pixel < first.length; pixel++) {
    if (!first[pixel] && !second[pixel]) continue;
    either++; if (first[pixel] && second[pixel]) both++;
    colors += (Math.abs(x[pixel * 3] - y[pixel * 3]) + Math.abs(x[pixel * 3 + 1] - y[pixel * 3 + 1]) + Math.abs(x[pixel * 3 + 2] - y[pixel * 3 + 2])) / (3 * 255);
  }
  if (!either) return 0;
  return .5 * (1 - both / either) + .5 * colors / either;
}

/** The reference beside the recreation at the same moments, each pair labeled with how far apart it is. */
export async function readCompare(path: string, directory: string, work: Work, signal: AbortSignal, onProgress: (percent: number) => void): Promise<NonNullable<MediaTaskResult['read']>> {
  const rendered = work.rendered ?? [], times = work.times ?? rendered.map(frame => frame.time);
  if (!rendered.length || rendered.length !== times.length) throw new AnalysisError('There are no timeline frames to compare with.', 400);
  const source = await probe(path, signal), last = Math.max(0, source.duration - 2 / source.fps);
  const tiles: { image: Buffer; label: string }[] = [], scores: { time: number; difference: number }[] = [];
  for (const [index, time] of times.entries()) {
    const reference = await frameAt(path, directory, Math.min(Math.max(0, time), last), undefined, `compare-${index}`, signal);
    const yours = Buffer.from(rendered[index].image, 'base64');
    const score = round(await difference(reference, yours));
    scores.push({ time: round(time), difference: score });
    // Pairs sit side by side: the sheet lays out an even number of columns, so a reference and its render share a row.
    tiles.push({ image: reference, label: `${index + 1}  ${time.toFixed(2)}s  reference` }, { image: yours, label: `${index + 1}  yours  diff ${Math.round(score * 100)}%` });
    onProgress(10 + Math.round(70 * (index + 1) / times.length));
  }
  const result = await sheet(tiles, source.width / source.height);
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps), frames: times.map(time => ({ time: round(time) })), scores };
}
