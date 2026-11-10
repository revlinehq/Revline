import { ffmpegTime } from '../ffmpeg-time.mjs';
import { roundTo } from '../math';
import type { FrameCache } from './frame-cache';
import { runMediaCommand as run } from './media-command';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/lib/media_task_contract';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { forEachLimited } from './run-limited';
import { MAX_LOOK_SAMPLES, scanSourceLooks } from './source-looks';

type Work = NonNullable<MediaWorkItem['read']>;
type Result = NonNullable<MediaTaskResult['read']>;
type Box = { x: number; y: number; w: number; h: number };
type Source = { width: number; height: number; fps: number; duration: number };

const SHEET_WIDTH = 1600, GAP = 8, LABEL = 30, MAX_IMAGE = 880_000, MAX_FRAMES = 30;
/** A pixel counts as changed between frames when its gray level moves more than this (of 255). */
const CHANGE = 24;
const sourceProbe = z.object({ streams: z.array(z.object({ width: z.number().positive(), height: z.number().positive(), r_frame_rate: z.string().optional(), side_data_list: z.array(z.object({ rotation: z.number().optional() })).optional(), tags: z.object({ rotate: z.string().optional() }).optional() })).optional(), format: z.object({ duration: z.string().optional() }).optional() });

export async function probe(path: string, signal: AbortSignal, cache?: FrameCache): Promise<Source> {
  if (cache) return cache.json({kind:'source-probe'}, () => probe(path, signal));
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:stream_side_data=rotation:stream_tags=rotate:format=duration', '-of', 'json', path], { signal, timeout: 30_000 });
  const value = sourceProbe.parse(JSON.parse(stdout));
  const stream = value.streams?.[0], [num, den] = (stream?.r_frame_rate ?? '30/1').split('/').map(Number);
  if (!stream?.width || !stream.height) throw new AnalysisError('This source has no video frames to read.', 400);
  // FFmpeg autorotates decoded frames. Every downstream crop, raw buffer and sheet uses those displayed axes.
  const rotation = stream.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? Number(stream.tags?.rotate ?? 0), swapped = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return { width: swapped ? stream.height : stream.width, height: swapped ? stream.width : stream.height, fps: den ? num / den : 30, duration: Number(value.format?.duration ?? 0) };
}

/** One frame at a source second, full resolution or cropped to a box, as PNG. */
export async function frameAt(path: string, directory: string, time: number, crop: Box | undefined, name: string, signal: AbortSignal, cache?: FrameCache): Promise<Buffer> {
  if (cache) return cache.bytes({ kind: 'reference-png', timeMs: Number(Math.max(0, time).toFixed(3)) * 1000, fallbackMs: [.05,.15,.3,.6,1,2].map(back=>Number(Math.max(0,time-back).toFixed(3))*1000), width: crop?.w ?? 'source', height: crop?.h ?? 'source', crop, format: 'png', decoder: 'ffmpeg-seek' }, 'image/png', () => frameAt(path, directory, time, crop, name, signal));
  const output = join(directory, `${name}.png`);
  // A seek at or near the very end can decode nothing (the container runs a little longer than the video).
  // Step back until a real frame comes out, so a whole-length read never fails on its last frame.
  for (const back of [0, .05, .15, .3, .6, 1, 2]) {
    await run('ffmpeg', ['-v', 'error', '-ss', ffmpegTime(Math.max(0, time - back)), '-i', path, '-map', '0:v:0', '-frames:v', '1', ...(crop ? ['-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : []), '-y', output], { signal, timeout: 30_000 });
    try { return await readFile(output); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  throw new AnalysisError(`No video frame could be decoded near ${time.toFixed(2)} s.`, 400);
}

const clampBox = (box: Box, source: Source): Box => {
  const x = Math.max(0, Math.min(source.width - 2, Math.round(box.x))), y = Math.max(0, Math.min(source.height - 2, Math.round(box.y)));
  return { x, y, w: Math.max(2, Math.min(source.width - x, Math.round(box.w))), h: Math.max(2, Math.min(source.height - y, Math.round(box.h))) };
};
const timesIn = (start: number, end: number, count: number, source: Source) => {
  // Times past the end read the last frames instead of failing.
  const last = Math.max(0, source.duration - 1 / source.fps), from = Math.min(start, last), to = Math.min(Math.max(end, from), last);
  return Array.from({ length: count }, (_, index) => roundTo(count === 1 ? from : from + (to - from) * index / (count - 1), 3));
};
const escape = (text: string) => text.replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]!);

/** Tiles in a grid, each labeled under it, as one JPEG small enough to hand to a model. */
export async function sheet(tiles: { image: Buffer; label: string; overlay?: string }[], aspect: number, across?: number, limit = MAX_IMAGE) {
  // Up to 4 across for a few frames; dense 10 fps reads (up to 30 frames) go 6 across so motion reads left to right.
  const columns = across ?? (tiles.length <= 4 ? tiles.length : tiles.length <= 16 ? Math.min(4, Math.ceil(Math.sqrt(tiles.length))) : 6);
  const rows = Math.ceil(tiles.length / columns);
  let tileWidth = Math.floor((SHEET_WIDTH - GAP * (columns + 1)) / columns), quality = 82;
  for (;;) {
    const tileHeight = Math.round(tileWidth / aspect), width = GAP + columns * (tileWidth + GAP), height = GAP + rows * (tileHeight + LABEL + GAP);
    const composites = await Promise.all(tiles.map(async (tile, index) => {
      const left = GAP + (index % columns) * (tileWidth + GAP), top = GAP + Math.floor(index / columns) * (tileHeight + LABEL + GAP);
      let image = sharp(tile.image).resize(tileWidth, tileHeight, { fit: 'fill' });
      if (tile.overlay) image = sharp(await image.png().toBuffer()).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${tileHeight}">${tile.overlay.replaceAll('{w}', String(tileWidth)).replaceAll('{h}', String(tileHeight))}</svg>`) }]);
      const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tileWidth}" height="${LABEL}"><text x="2" y="21" font-family="Helvetica, Arial, sans-serif" font-size="17" fill="#f2f2f2">${escape(tile.label)}</text></svg>`);
      return [{ input: await image.png().toBuffer(), left, top }, { input: label, left, top: top + tileHeight }];
    }));
    const data = (await sharp({ create: { width, height, channels: 3, background: '#161616' } }).composite(composites.flat()).jpeg({ quality }).toBuffer()).toString('base64');
    if (data.length <= limit) return { image: data, width, height };
    if (quality > 60) quality -= 10; else tileWidth = Math.floor(tileWidth * .8);
  }
}

/** Frames across a window, or a crop of them magnified, with how much each one changed from the frame before. */
async function readSheet(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, cache?: FrameCache): Promise<Result> {
  // fps reads consecutive moments (a transition at 10 fps); count spreads frames evenly across the window.
  const span = Math.max(0, work.end - work.start), count = work.fps ? Math.max(2, Math.min(MAX_FRAMES, Math.floor(span * work.fps) + 1)) : Math.max(1, Math.min(MAX_FRAMES, work.count ?? 8));
  const crop = work.crop ? clampBox(work.crop, source) : undefined, times = work.times?.length ? [...new Set(work.times)].sort((a,b)=>a-b).slice(0,MAX_FRAMES) : work.fps ? timesIn(work.start, work.start + (count - 1) / work.fps, count, source) : timesIn(work.start, work.end, count, source);
  const images: Buffer[] = new Array(times.length);
  let done = 0;
  await forEachLimited(times.map((time, index) => ({ time, index })), 4, async ({ time, index }, stop) => {
    images[index] = await frameAt(path, directory, time, crop, `sheet-${index}`, AbortSignal.any([signal, stop]), cache);
    onProgress(10 + 60 * ++done / times.length);
  });
  // Change is measured on a small gray copy; the changed box is mapped back to source pixels.
  const area = crop ?? { x: 0, y: 0, w: source.width, h: source.height }, small = Math.min(160, area.w), factor = area.w / small;
  const grays = await Promise.all(images.map(image => sharp(image).resize(small).grayscale().raw().toBuffer({ resolveWithObject: true })));
  const frames = times.map((time, index) => {
    if (!index) return { time };
    const current = grays[index], previous = grays[index - 1], width = current.info.width, height = current.info.height;
    let sum = 0, left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const delta = Math.abs(current.data[y * width + x] - previous.data[y * width + x]); sum += delta;
      if (delta > CHANGE) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    const change = roundTo(sum / (width * height * 255), 3);
    return right < 0 ? { time, change } : { time, change, changed: { x: Math.round(area.x + left * factor), y: Math.round(area.y + top * factor), w: Math.round((right - left + 1) * factor), h: Math.round((bottom - top + 1) * factor) } };
  });
  onProgress(80);
  const tiles = images.map((image, index) => ({ image, label: `${index + 1}  ${times[index].toFixed(2)}s${frames[index].change !== undefined ? `  change ${Math.round(frames[index].change! * 100)}%` : ''}` }));
  const result = await sheet(tiles, area.w / area.h);
  const { moments } = work.stillsOnly ? { moments: [] } : await findMoments(path, work.start, work.end, source, area, signal, 12, cache).catch(error => { if (signal.aborted) throw error; return { moments: [] }; });
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames, moments };
}

/** Only the map of a long window: every moment and every hold, no frames and no image (cheap on a long talking-head clip). */
async function readMoments(path: string, source: Source, work: Work, signal: AbortSignal, cache?: FrameCache): Promise<Result> {
  const area = work.crop ? clampBox(work.crop, source) : { x: 0, y: 0, w: source.width, h: source.height };
  const { moments, holds } = await findMoments(path, work.start, work.end, source, area, signal, 80, cache);
  return { width: 0, height: 0, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: [], moments, holds };
}

/** Where the picture changes in a window, from every frame at 10 fps (cheap: small gray frames, no images for the model):
 * each moment's start, end, how strong it was, the region that moved, and whether it was a hard cut or motion. */
async function findMoments(path: string, start: number, end: number, source: Source, area: Box, signal: AbortSignal, limit = 12, cache?: FrameCache): Promise<{ moments: { start: number; end: number; peak: number; kind: 'cut' | 'motion'; region?: Box }[]; holds: { start: number; end: number }[]; changed: boolean }> {
  if (cache) return cache.json({ kind: 'moments', start, end, source, area, limit }, () => findMoments(path, start, end, source, area, signal, limit));
  const from = Math.max(0, Math.min(start, source.duration)), to = Math.min(Math.max(end, from), source.duration), rate = 10;
  if (to - from < .2) return { moments: [], holds: [], changed: false };
  // A window up to 30 s is read wide enough that an app icon or one key is several pixels, not one; long maps stay small.
  const width = to - from <= 30 ? 256 : 96, height = Math.max(2, Math.round(width * area.h / area.w) & ~1);
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', ffmpegTime(from), '-t', ffmpegTime(to - from), '-i', path, '-map', '0:v:0', '-vf', `fps=${rate},crop=${area.w}:${area.h}:${area.x}:${area.y},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], { signal, timeout: Math.max(120_000, Math.ceil((to - from) * 1000)), encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  const size = width * height, total = Math.floor(stdout.length / size), factor = area.w / width;
  if (total < 2) return { moments: [], holds: [], changed: false };
  const frame = (index: number) => stdout.subarray(index * size, (index + 1) * size);
  // Pixels that change in most steps (a looping waveform, a ticking counter) are the video's idle motion: left out of
  // the counts, so an icon swapping or a word typing elsewhere still stands out.
  const counts = new Uint16Array(size);
  for (let index = 0; index < total - 1; index++) { const a = frame(index), b = frame(index + 1); for (let i = 0; i < size; i++) if (Math.abs(b[i] - a[i]) > CHANGE) counts[i]++; }
  const busy = counts.map(count => total > 6 && count > (total - 1) * .5 ? 1 : 0);
  const steps = Array.from({ length: total - 1 }, (_, index) => {
    const a = frame(index), b = frame(index + 1);
    let sum = 0, moved = 0, left = width, top = height, right = -1, bottom = -1;
    for (let i = 0; i < size; i++) { const delta = Math.abs(b[i] - a[i]); sum += delta; if (delta > CHANGE && !busy[i]) { moved++; const x = i % width, y = (i / width) | 0; if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; } }
    return { change: sum / (size * 255), moved: moved / size, box: right < 0 ? null : { left, top, right, bottom } };
  });
  // Share of the picture that differs between two frames: a small key or a thin stroke moving is a few pixels, not a big mean change.
  const differs = (a: number, b: number) => { const x = frame(a), y = frame(b); let moved = 0; for (let i = 0; i < size; i++) if (Math.abs(x[i] - y[i]) > CHANGE && !busy[i]) moved++; return moved / size; };
  // A moment is a run of steps clearly above this video's own resting level; one-step jumps are cuts.
  // Resting is the quiet end of this video (its 20th percentile), not its middle: in a busy film the median is already motion.
  const quiet = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length * .2)];
  const sorted = steps.map(step => step.change).sort((a, b) => a - b), resting = quiet(sorted);
  const restingMoved = quiet(steps.map(step => step.moved));
  // A short window (an fps read of one transition) may be motion from end to end, so its own median is no baseline: fixed floors only there.
  // A dozen changed pixels is something (an icon at this width); the idle motion is already left out of the count.
  const minimum = 12 / size, short = to - from <= 3.5, threshold = short ? .012 : Math.max(.012, resting * 3), movedFloor = short ? Math.max(minimum, .002) : Math.max(minimum, restingMoved * 3);
  // Fades and slow slides change each pixel only a little per frame: compare every frame with the one half a second
  // earlier too, against that lag's own resting level, so a slow change is a moment as well.
  const lag = Math.min(5, steps.length), lagged = steps.map((_, index) => differs(Math.max(0, index + 1 - lag), index + 1));
  const lagFloor = Math.max(minimum * 2, short ? .003 : quiet(lagged) * 3);
  const activeAt = (index: number) => steps[index].change >= threshold || steps[index].moved >= movedFloor || lagged[index] >= lagFloor;
  const moments: { start: number; end: number; peak: number; kind: 'cut' | 'motion'; region?: Box }[] = [];
  for (let index = 0; index < steps.length; index++) {
    if (!activeAt(index)) continue;
    let last = index; while (last + 1 < steps.length && (activeAt(last + 1) || (last + 2 < steps.length && activeAt(last + 2)))) last++;
    const run = steps.slice(index, last + 1), peak = Math.max(...run.map(step => step.change));
    const boxes = run.flatMap(step => step.box ? [step.box] : []);
    const region = boxes.length ? { x: Math.round(area.x + Math.min(...boxes.map(b => b.left)) * factor), y: Math.round(area.y + Math.min(...boxes.map(b => b.top)) * factor), w: Math.round((Math.max(...boxes.map(b => b.right)) - Math.min(...boxes.map(b => b.left)) + 1) * factor), h: Math.round((Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)) + 1) * factor) } : undefined;
    moments.push({ start: roundTo(from + index / rate, 2), end: roundTo(from + (last + 1) / rate, 2), peak: roundTo(peak, 3), kind: run.length === 1 && peak > .25 ? 'cut' : 'motion', ...(region ? { region } : {}) });
    index = last;
  }
  // Holds: a second or more where the picture all but stops, well under this video's resting level (a frozen face, a held still).
  const still = Math.max(.0015, resting * .35), holds: { start: number; end: number }[] = [];
  for (let index = 0; index < steps.length; index++) {
    if (steps[index].change >= still || steps[index].moved >= movedFloor) continue;
    let last = index; while (last + 1 < steps.length && steps[last + 1].change < still && steps[last + 1].moved < movedFloor) last++;
    // Slow drift adds up: a stretch whose first and last frames differ is moving, however small each step.
    if (last - index + 1 >= rate && differs(index, last + 1) < movedFloor) holds.push({ start: roundTo(from + index / rate, 2), end: roundTo(from + (last + 1) / rate, 2) });
    index = last;
  }
  // The strongest ones, in time order.
  return { moments: moments.sort((a, b) => b.peak - a.peak).slice(0, limit).sort((a, b) => a.start - b.start), holds: holds.slice(0, limit), changed: differs(0, total - 1) >= movedFloor };
}








/** A rotated box outline in tile coordinates ({w} and {h} are the tile size). */
/** The shared "eyes" read. With times alone: measured face signals at those frames (no image, no model service).
 * With count: the same times as strips of `count` frames side by side, each frame about 480 px wide, one strip per spot. */
async function readLooks(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, cache?: FrameCache): Promise<Result> {
  const times = (work.times ?? []).filter(time => time >= 0 && time <= source.duration + .05).map(time => Math.min(time, Math.max(0, source.duration - 1 / Math.max(1, source.fps))));
  if (!times.length || times.length > MAX_LOOK_SAMPLES) throw new AnalysisError(`Give 1 to ${MAX_LOOK_SAMPLES} source times to look at.`, 400);
  const base = { sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3) };
  if (!work.count) {
    const looks = await scanSourceLooks(path, times, signal, percent => onProgress(5 + percent * .9));
    return { ...base, width: looks.width, height: looks.height, frames: [], looks: looks.samples };
  }
  const per = Math.max(1, Math.min(6, work.count)), strips: string[] = [];
  let width = 0, height = 0;
  for (let index = 0; index < times.length; index += per) {
    const group = times.slice(index, index + per);
    const images = await Promise.all(group.map((time, tile) => frameAt(path, directory, time, undefined, `look-${index + tile}`, signal, cache)));
    const strip = await sheet(images.map((image, tile) => ({ image, label: `${group[tile].toFixed(2)}s` })), source.width / source.height, group.length);
    // About 480 px per frame keeps a look judgment cheap; text checks use full-resolution reads instead.
    const target = Math.min(strip.width, 16 + group.length * 488);
    const small = target < strip.width ? await sharp(Buffer.from(strip.image, 'base64')).resize({ width: target }).jpeg({ quality: 78 }).toBuffer({ resolveWithObject: true }) : undefined;
    strips.push(small ? small.data.toString('base64') : strip.image);
    width = small?.info.width ?? strip.width; height = small?.info.height ?? strip.height;
    onProgress(5 + 90 * Math.min(1, (index + per) / times.length));
  }
  return { ...base, width, height, frames: times.map(time => ({ time })), extraImages: strips };
}


/** A still uses its displayed pixels once; it has no artificial source duration or frame rate. */
export async function imageSource(path: string) {
  const image = await sharp(path).rotate().png().toBuffer(), meta = await sharp(image).metadata();
  return { image, width: meta.width!, height: meta.height!, fps: 0, duration: 0 };
}

export async function readReference(path: string, directory: string, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, stillImage = false, cache?: FrameCache): Promise<Result> {
  if (stillImage) {
    signal.throwIfAborted();
    const source = await imageSource(path), crop = work.crop ? clampBox(work.crop, source) : undefined;
    const image = crop ? await sharp(source.image).extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h }).png().toBuffer() : source.image;
    const result = await sheet([{ image, label: 'Still image' }], (crop?.w ?? source.width) / (crop?.h ?? source.height), 1);
    onProgress(90);
    return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: 0, frames: [{ time: 0 }] };
  }
  const source = await probe(path, signal, cache);
  if (work.end < work.start) throw new AnalysisError('The window ends before it starts.', 400);
  onProgress(5);
  if (work.mode === 'looks') return readLooks(path, directory, source, work, signal, onProgress, cache);
  // Tracking, measuring, tracing, font matching, sound and motion reads were removed with the motion lanes.
  if (work.mode !== 'sheet') throw new AnalysisError(`The ${work.mode} read is no longer supported.`, 400);
  if (work.momentsOnly) return readMoments(path, source, work, signal, cache);
  return readSheet(path, directory, source, work, signal, onProgress, cache);
}

