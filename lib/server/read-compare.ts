import sharp from 'sharp';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { frameAt, probe, sheet } from './read-reference';

type Work = NonNullable<MediaWorkItem['read']>;
const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;

/** How different two pictures are, 0 (the same) to 1: the mean color difference at one small common size, so layout,
 * position, size and color all count, and fine grain does not. */
async function difference(a: Buffer, b: Buffer) {
  const small = (image: Buffer) => sharp(image).resize(96, 54, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const [x, y] = await Promise.all([small(a), small(b)]);
  let sum = 0;
  for (let index = 0; index < x.length; index++) sum += Math.abs(x[index] - y[index]);
  return sum / (x.length * 255);
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
