import { roundTo } from '../math';
import type { FrameCache } from './frame-cache';
import { runMediaCommand as run } from './media-command';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { fitMotion } from '@/lib/media-analysis/fit-motion';
import { trackReference } from './track-reference';
import { describeSounds } from '@/lib/media-analysis/gemini';
import { detectOnsets, SOUND_RATE, visualHits } from '@/lib/media-analysis/sound';
import { mapMotion, motionWindow } from '@/lib/inspo-motion/motion-map';
import { cropBounds, referenceCropAt } from '@/lib/ai/reference-comparison';
import { measure } from './blueprint-check';
import { forEachLimited } from './run-limited';
import { traceShape } from './trace-shape';
import { matchFont, type FontCategory } from './match-font';

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
    await run('ffmpeg', ['-v', 'error', '-ss', Math.max(0, time - back).toFixed(3), '-i', path, '-map', '0:v:0', '-frames:v', '1', ...(crop ? ['-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : []), '-y', output], { signal, timeout: 30_000 });
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
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', path, '-map', '0:v:0', '-vf', `fps=${rate},crop=${area.w}:${area.h}:${area.x}:${area.y},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], { signal, timeout: Math.max(120_000, Math.ceil((to - from) * 1000)), encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
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

/** Exact colors at points and color edges along lines, in source pixels of one frame. */
async function readMeasure(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, cache?: FrameCache): Promise<Result> {
  const [time] = timesIn(work.start, work.start, 1, source);
  const { data, info } = await sharp(await frameAt(path, directory, time, undefined, 'measure', signal, cache)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { colors, edges } = measure({ data, width: info.width, height: info.height }, work);
  return { width: info.width, height: info.height, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: [{ time }], colors, edges: edges?.map(edge => ({ ...edge, changes: strongEdges(edge.changes) })) };
}

/** The Google Fonts closest to the type in a crop, with the crop above each candidate drawn in the crop's colors. */
async function readFont(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, cache?: FrameCache): Promise<Result> {
  if (!work.crop || !work.text) throw new AnalysisError('Matching a font needs a crop around the text and the text itself.', 400);
  const box = clampBox(work.crop, source), [time] = timesIn(work.start, work.start, 1, source);
  const crop = await frameAt(path, directory, time, box, 'font', signal, cache);
  const found = await matchFont(crop, work.text, { categories: work.categories as FontCategory[] | undefined, signal, onProgress });
  const result = await sheet(found.tiles, found.aspect, 1);
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: [{ time }], fonts: found.matches, fontColors: { ink: found.inkColor, background: found.background } };
}

/** One shape in a box traced to SVG paths; the sheet sets the crop beside the trace drawn over the background. */
async function readTrace(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, cache?: FrameCache): Promise<Result> {
  if (!work.box) throw new AnalysisError('Tracing needs a box around the shape.', 400);
  const box = clampBox(work.box, source), [time] = timesIn(work.start, work.start, 1, source);
  const crop = await frameAt(path, directory, time, box, 'trace', signal, cache);
  let traced: Awaited<ReturnType<typeof traceShape>>;
  try { traced = await traceShape(crop, { ...(work.color ? { color: work.color } : {}), ...(work.tolerance ? { tolerance: work.tolerance } : {}) }); }
  catch (error) { throw new AnalysisError((error as Error).message, 400); }
  const { width, height, ...trace } = traced;
  const spine = trace.centerline ? `<path d="${trace.centerline.d}" fill="none" stroke="#ff3b30" stroke-width="${Math.max(2, width / 200)}"/>` : '';
  const drawn = await sharp(Buffer.from(trace.svg.replace('<svg ', `<svg width="${width}" height="${height}" `).replace('>', `><rect width="${width}" height="${height}" fill="${trace.background}"/>`).replace('</svg>', `${spine}</svg>`))).png().toBuffer();
  const result = await sheet([{ image: crop, label: `crop ${time.toFixed(2)}s` }, { image: drawn, label: `trace ${trace.paths.length} paths, spine in red` }], width / height, 2);
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: [{ time }], trace: { box, ...trace } };
}

/** Footage is textured: every grain of concrete is a small color step. Keep the jumps that stand out along the line, in order. */
function strongEdges(changes: { at: number; before: string; after: string }[]) {
  const jump = (change: { before: string; after: string }) => [1, 3, 5].reduce((sum, offset) => sum + Math.abs(parseInt(change.after.slice(offset, offset + 2), 16) - parseInt(change.before.slice(offset, offset + 2), 16)), 0);
  const strongest = Math.max(0, ...changes.map(jump));
  const kept = changes.filter(change => jump(change) >= Math.max(48, strongest * .4));
  return kept.length > 12 ? [...kept].sort((a, b) => jump(b) - jump(a)).slice(0, 12).sort((a, b) => a.at - b.at) : kept;
}

/** Follow one box from the first frame: position, size, scale and rotation per frame, plus a sheet with the box drawn. */
async function readTrack(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, cache?: FrameCache): Promise<Result> {
  if (!work.box) throw new AnalysisError('Tracking needs a box around the object in the first frame.', 400);
  const box = clampBox(work.box, source), start = Math.min(work.start, Math.max(0, source.duration - .05)), end = Math.min(Math.max(work.end, start + .05), source.duration);
  if (end - start > 12) throw new AnalysisError('Track up to 12 s at a time, including holds before and after the move.', 400);
  const frameTime = work.frameTime ?? start;
  if (frameTime < start || frameTime >= end) throw new AnalysisError('frameTime must be inside the tracking window.', 400);
  if (work.backgroundTime !== undefined && (work.backgroundTime < 0 || work.backgroundTime >= source.duration)) throw new AnalysisError('backgroundTime must be inside the source video.', 400);
  const track = await trackReference(path, { start, end, box, frameTime, ...(work.backgroundTime !== undefined ? { backgroundTime: work.backgroundTime } : {}) }, signal, onProgress);
  // The sheet: up to 8 tracked frames in color with the box drawn where it was found.
  const picks = [...new Set(Array.from({ length: Math.min(8, track.length) }, (_, index) => Math.round(index * (track.length - 1) / Math.max(1, Math.min(8, track.length) - 1))))];
  const images = await Promise.all(picks.map(index => frameAt(path, directory, track[index].time, undefined, `track-${index}`, signal, cache)));
  onProgress(90);
  const tiles = picks.map((index, order) => {
    const item = track[index];
    return { image: images[order], label: `${index + 1}  ${item.time.toFixed(2)}s  ${item.rotation}°  ×${item.scale}  conf ${item.confidence}`, overlay: boxOverlay(item, source) };
  });
  const result = await sheet(tiles, source.width / source.height);
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: picks.map(index => ({ time: track[index].time })), track, moves: fitMotion(track, source), trackingNotes: ['Geometry is frozen and excluded from fitting when invisible or lost.', 'Sharpness is relative to the seed frame; it is not blur in pixels.', ...(work.backgroundTime === undefined ? ['Opacity unavailable: provide a clean backgroundTime and a fully visible frameTime to calibrate alpha.'] : ['Opacity is a registered background/foreground blend; use only samples with opacityConfidence >= 0.5.'])] };
}

/** Hear a reference: every sound effect's measured onset, length and level, the picture change it lands on, and what it
 *  sounds like with a prompt to regenerate it (Gemini listens; the timing is measured, never guessed). */
async function readSounds(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, cache?: FrameCache): Promise<Result> {
  const from = Math.max(0, Math.min(work.start, source.duration)), to = Math.min(Math.max(work.end, from), source.duration), length = to - from;
  if (length < .3) throw new AnalysisError('Listen to at least 0.3 s.', 400);
  if (length > 60) throw new AnalysisError('Listen to at most 60 s at a time.', 400);
  const window = ['-ss', from.toFixed(3), '-t', length.toFixed(3), '-i', path];
  const audio = await run('ffmpeg', ['-v', 'error', ...window, '-map', '0:a:0', '-ac', '1', '-ar', String(SOUND_RATE), '-f', 'f32le', '-'], { signal, timeout: 120_000, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 }).catch(() => null);
  if (!audio?.stdout.length) throw new AnalysisError('This video has no sound to listen to.', 400);
  const bytes = audio.stdout as Buffer, mono = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - bytes.length % 4));
  onProgress(25);
  // Each onset lasts until it falls 24 dB under its peak or the next one starts.
  const onsets = detectOnsets(mono).slice(0, 40), hop = Math.round(SOUND_RATE / 100);
  const level = (at: number) => { let peak = 0; for (let i = at; i < Math.min(mono.length, at + hop); i++) peak = Math.max(peak, Math.abs(mono[i])); return peak; };
  const measured = onsets.map((onset, index) => {
    const first = Math.round(onset.time * SOUND_RATE), stop = Math.round((onsets[index + 1]?.time ?? length) * SOUND_RATE), floor = 10 ** ((onset.level - 24) / 20);
    let at = first + hop; while (at < stop && level(at) > floor) at += hop;
    return { time: onset.time, end: Math.min(at, stop) / SOUND_RATE, level: onset.level };
  });
  // The picture changes at 30 fps, as checkSound measures them, so each sound names the hit it lands on.
  const fps = 30, width = 160, height = Math.max(2, Math.round(width * source.height / source.width) & ~1);
  const { stdout: pixels } = await run('ffmpeg', ['-v', 'error', ...window, '-map', '0:v:0', '-vf', `fps=${fps},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], { signal, timeout: 120_000, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  const size = width * height, frames = Array.from({ length: Math.floor(pixels.length / size) }, (_, index) => new Uint8Array(pixels.buffer, pixels.byteOffset + index * size, size));
  const hits = visualHits(frames, 0, fps);
  onProgress(50);
  // Gemini hears the window as a small clip with its picture, so it can say what each sound accompanies.
  const clip = join(directory, 'listen.mp4');
  await run('ffmpeg', ['-v', 'error', '-y', ...window, '-vf', 'scale=-2:360', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-c:a', 'aac', '-b:a', '128k', clip], { signal, timeout: 180_000 });
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  // The timing stands on its own: when listening fails, the sounds come back measured but undescribed.
  const heard = key ? await describeSounds(clip, measured.map(sound => sound.time), key, signal).catch(error => { console.warn('[listenReference] describing failed', error instanceof Error ? error.message : error); return undefined; }) : undefined;
  onProgress(90);
  const sounds = measured.map(sound => {
    const hit = hits.reduce<typeof hits[number] | undefined>((best, item) => Math.abs(item.time - sound.time) <= .15 && (!best || Math.abs(item.time - sound.time) < Math.abs(best.time - sound.time)) ? item : best, undefined);
    const described = heard?.sounds.reduce<typeof heard.sounds[number] | undefined>((best, item) => !best || Math.abs(item.time - sound.time) < Math.abs(best.time - sound.time) ? item : best, undefined);
    return { time: roundTo(from + sound.time, 3), end: roundTo(from + sound.end, 3), level: roundTo(sound.level, 1), ...(hit ? { hit: roundTo(from + hit.time, 3) } : {}), ...(described && Math.abs(described.time - sound.time) <= .25 ? { kind: described.kind, description: described.description, prompt: described.prompt, onScreen: described.onScreen } : {}) };
  });
  return { width: 0, height: 0, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: [], sounds, ...(heard ? { music: heard.music } : {}), silentHits: hits.filter(hit => !measured.some(sound => Math.abs(sound.time - hit.time) <= .15)).map(hit => roundTo(from + hit.time, 3)) };
}

/** How a reference moves (motionMap): camera keyframes with eases, transitions, element tweens and content changes,
 *  read from small gray frames at 30 fps. The same reading runs on a rendered timeline range, so the two compare. */
async function readMotion(path: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void, cache?: FrameCache): Promise<Result> {
  if (work.end - work.start < .3 || work.end - work.start > 12) throw new AnalysisError('Map 0.3 to 12 s.', 400);
  const fps = 30, from = Math.floor(Math.max(0, work.start - .5) * fps) / fps, to = Math.min(work.end + .5, source.duration);
  const region = referenceCropAt(work.start, work.compareCrop, work.referenceCropKeyframes);
  const crop = region ? cropBounds(region, source.width, source.height) : undefined;
  const width = 320, height = Math.max(2, Math.round(width * (crop?.height ?? source.height) / (crop?.width ?? source.width)));
  // Perspective maps a time-varying source rectangle onto a fixed canvas, including width/height changes.
  // Decode on displayed axes at full resolution; only reduce after selecting the region.
  const keys = work.referenceCropKeyframes;
  const coordinate = (field: 'x' | 'y' | 'w' | 'h') => keys![0].crop[field] + keys!.slice(1).map((key, index) => {
    const a = keys![index];
    return `+(${key.crop[field] - a.crop[field]})*clip((${from}+on/${fps}-${a.time})/${key.time - a.time},0,1)`;
  }).join('');
  const x = keys ? coordinate('x') : '', y = keys ? coordinate('y') : '', w = keys ? coordinate('w') : '', h = keys ? coordinate('h') : '';
  const selection = keys ? [`perspective=x0='W*(${x})':y0='H*(${y})':x1='W*((${x})+(${w}))':y1='H*(${y})':x2='W*(${x})':y2='H*((${y})+(${h}))':x3='W*((${x})+(${w}))':y3='H*((${y})+(${h}))':sense=source:eval=frame`] : crop ? [`crop=${crop.width}:${crop.height}:${crop.left}:${crop.top}`] : [];
  const filter = [`fps=${fps}`, ...selection, `scale=${width}:${height}`, 'format=gray'].join(',');
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', from.toFixed(6), '-t', (to - from).toFixed(6), '-i', path, '-map', '0:v:0', '-vf', filter, '-f', 'rawvideo', '-'], { signal, timeout: 120_000, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
  const size = width * height, frames = Array.from({ length: Math.floor(stdout.length / size) }, (_, index) => new Uint8Array(stdout.buffer, stdout.byteOffset + index * size, size));
  if (frames.length < 3) throw new AnalysisError('No frames could be read in that window.', 400);
  onProgress(40);
  return { width: 0, height: 0, sourceWidth: source.width, sourceHeight: source.height, fps: roundTo(source.fps, 3), frames: [], motion: { ...motionWindow(mapMotion(frames, width, height, from, fps), work.start, Math.min(work.end, source.duration)), sourceFps: roundTo(source.fps, 3) } };
}

/** A rotated box outline in tile coordinates ({w} and {h} are the tile size). */
function boxOverlay(item: { x: number; y: number; w: number; h: number; rotation: number }, source: Source) {
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  return `<svg viewBox="0 0 ${source.width} ${source.height}" width="{w}" height="{h}" preserveAspectRatio="none"><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" transform="rotate(${item.rotation} ${cx} ${cy})" fill="none" stroke="#3dd68c" stroke-width="${Math.max(3, source.width / 300)}"/></svg>`;
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
    const result = await sheet([{ image, label: 'Still image reference' }], (crop?.w ?? source.width) / (crop?.h ?? source.height), 1);
    onProgress(90);
    return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: 0, frames: [{ time: 0 }] };
  }
  const source = await probe(path, signal, cache);
  if (work.end < work.start) throw new AnalysisError('The window ends before it starts.', 400);
  onProgress(5);
  if (work.mode === 'measure') return readMeasure(path, directory, source, work, signal, cache);
  if (work.mode === 'track') return readTrack(path, directory, source, work, signal, onProgress, cache);
  if (work.mode === 'trace') return readTrace(path, directory, source, work, signal, cache);
  if (work.mode === 'font') return readFont(path, directory, source, work, signal, onProgress, cache);
  if (work.mode === 'motion') return readMotion(path, source, work, signal, onProgress, cache);
  if (work.mode === 'sounds') return readSounds(path, directory, source, work, signal, onProgress, cache);
  if (work.momentsOnly) return readMoments(path, source, work, signal, cache);
  return readSheet(path, directory, source, work, signal, onProgress, cache);
}

/** Every moment across a whole video, for the reference breakdown; regions as 0..1 boxes of the frame. */
export async function videoMoments(path: string, signal: AbortSignal) {
  const source = await probe(path, signal);
  const { moments } = await findMoments(path, 0, source.duration, source, { x: 0, y: 0, w: source.width, h: source.height }, signal, 40);
  const share = (value: number, total: number) => roundTo(Math.min(1, value / total), 3);
  return moments.map(({ region, ...moment }) => ({ ...moment, ...(region ? { box: { left: share(region.x, source.width), top: share(region.y, source.height), right: share(region.x + region.w, source.width), bottom: share(region.y + region.h, source.height) } } : {}) }));
}
