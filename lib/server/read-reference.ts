import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { fitMotion } from '@/lib/media-analysis/fit-motion';
import { followBox } from '@/lib/media-analysis/follow-box';
import { measure } from './blueprint-check';
import { forEachLimited } from './run-limited';

type Work = NonNullable<MediaWorkItem['read']>;
type Result = NonNullable<MediaTaskResult['read']>;
type Box = { x: number; y: number; w: number; h: number };
type Source = { width: number; height: number; fps: number; duration: number };

const run = promisify(execFile);
const SHEET_WIDTH = 1600, GAP = 8, LABEL = 30, MAX_IMAGE = 880_000, MAX_FRAMES = 30;
/** A pixel counts as changed between frames when its gray level moves more than this (of 255). */
const CHANGE = 24;
const round = (value: number, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

async function probe(path: string, signal: AbortSignal): Promise<Source> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', path], { signal, timeout: 30_000 });
  const value = JSON.parse(stdout) as { streams?: { width?: number; height?: number; r_frame_rate?: string }[]; format?: { duration?: string } };
  const stream = value.streams?.[0], [num, den] = (stream?.r_frame_rate ?? '30/1').split('/').map(Number);
  if (!stream?.width || !stream.height) throw new AnalysisError('This source has no video frames to read.', 400);
  return { width: stream.width, height: stream.height, fps: den ? num / den : 30, duration: Number(value.format?.duration ?? 0) };
}

/** One frame at a source second, full resolution or cropped to a box, as PNG. */
async function frameAt(path: string, directory: string, time: number, crop: Box | undefined, name: string, signal: AbortSignal) {
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
  const last = Math.max(0, source.duration - 2 / source.fps), from = Math.min(start, last), to = Math.min(Math.max(end, from), last);
  return Array.from({ length: count }, (_, index) => round(count === 1 ? from : from + (to - from) * index / (count - 1), 3));
};
const escape = (text: string) => text.replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]!);

/** Tiles in a grid, each labeled under it, as one JPEG small enough to hand to a model. */
async function sheet(tiles: { image: Buffer; label: string; overlay?: string }[], aspect: number) {
  // Up to 4 across for a few frames; dense 10 fps reads (up to 30 frames) go 6 across so motion reads left to right.
  const columns = tiles.length <= 4 ? tiles.length : tiles.length <= 16 ? Math.min(4, Math.ceil(Math.sqrt(tiles.length))) : 6;
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
    if (data.length <= MAX_IMAGE) return { image: data, width, height };
    if (quality > 60) quality -= 10; else tileWidth = Math.floor(tileWidth * .8);
  }
}

/** Frames across a window, or a crop of them magnified, with how much each one changed from the frame before. */
async function readSheet(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void): Promise<Result> {
  // fps reads consecutive moments (a transition at 10 fps); count spreads frames evenly across the window.
  const span = Math.max(0, work.end - work.start), count = work.fps ? Math.max(2, Math.min(MAX_FRAMES, Math.floor(span * work.fps) + 1)) : Math.max(1, Math.min(MAX_FRAMES, work.count ?? 8));
  const crop = work.crop ? clampBox(work.crop, source) : undefined, times = work.fps ? timesIn(work.start, work.start + (count - 1) / work.fps, count, source) : timesIn(work.start, work.end, count, source);
  const images: Buffer[] = new Array(times.length);
  let done = 0;
  await forEachLimited(times.map((time, index) => ({ time, index })), 4, async ({ time, index }, stop) => {
    images[index] = await frameAt(path, directory, time, crop, `sheet-${index}`, AbortSignal.any([signal, stop]));
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
    const change = round(sum / (width * height * 255), 3);
    return right < 0 ? { time, change } : { time, change, changed: { x: Math.round(area.x + left * factor), y: Math.round(area.y + top * factor), w: Math.round((right - left + 1) * factor), h: Math.round((bottom - top + 1) * factor) } };
  });
  onProgress(80);
  const tiles = images.map((image, index) => ({ image, label: `${index + 1}  ${times[index].toFixed(2)}s${frames[index].change !== undefined ? `  change ${Math.round(frames[index].change! * 100)}%` : ''}` }));
  const result = await sheet(tiles, area.w / area.h);
  const moments = await findMoments(path, work.start, work.end, source, area, signal).catch(error => { if (signal.aborted) throw error; return []; });
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps, 3), frames, moments };
}

/** Where the picture changes in a window, from every frame at 10 fps (cheap: small gray frames, no images for the model):
 * each moment's start, end, how strong it was, the region that moved, and whether it was a hard cut or motion. */
async function findMoments(path: string, start: number, end: number, source: Source, area: Box, signal: AbortSignal) {
  const from = Math.max(0, Math.min(start, source.duration)), to = Math.min(Math.max(end, from), source.duration), rate = 10;
  if (to - from < .2) return [];
  const width = 96, height = Math.max(2, Math.round(width * area.h / area.w) & ~1);
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', path, '-map', '0:v:0', '-vf', `fps=${rate},crop=${area.w}:${area.h}:${area.x}:${area.y},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], { signal, timeout: 120_000, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  const size = width * height, total = Math.floor(stdout.length / size), factor = area.w / width;
  if (total < 2) return [];
  const steps = Array.from({ length: total - 1 }, (_, index) => {
    const a = stdout.subarray(index * size, (index + 1) * size), b = stdout.subarray((index + 1) * size, (index + 2) * size);
    let sum = 0, left = width, top = height, right = -1, bottom = -1;
    for (let i = 0; i < size; i++) { const delta = Math.abs(b[i] - a[i]); sum += delta; if (delta > CHANGE) { const x = i % width, y = (i / width) | 0; if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; } }
    return { change: sum / (size * 255), box: right < 0 ? null : { left, top, right, bottom } };
  });
  // A moment is a run of steps clearly above this video's own resting level; one-step jumps are cuts.
  const sorted = steps.map(step => step.change).sort((a, b) => a - b), resting = sorted[Math.floor(sorted.length / 2)];
  const threshold = Math.max(.012, resting * 3);
  const moments: { start: number; end: number; peak: number; kind: 'cut' | 'motion'; region?: Box }[] = [];
  for (let index = 0; index < steps.length; index++) {
    if (steps[index].change < threshold) continue;
    let last = index; while (last + 1 < steps.length && (steps[last + 1].change >= threshold || (last + 2 < steps.length && steps[last + 2].change >= threshold))) last++;
    const run = steps.slice(index, last + 1), peak = Math.max(...run.map(step => step.change));
    const boxes = run.flatMap(step => step.box ? [step.box] : []);
    const region = boxes.length ? { x: Math.round(area.x + Math.min(...boxes.map(b => b.left)) * factor), y: Math.round(area.y + Math.min(...boxes.map(b => b.top)) * factor), w: Math.round((Math.max(...boxes.map(b => b.right)) - Math.min(...boxes.map(b => b.left)) + 1) * factor), h: Math.round((Math.max(...boxes.map(b => b.bottom)) - Math.min(...boxes.map(b => b.top)) + 1) * factor) } : undefined;
    moments.push({ start: round(from + index / rate, 2), end: round(from + (last + 1) / rate, 2), peak: round(peak, 3), kind: run.length === 1 && peak > .25 ? 'cut' : 'motion', ...(region ? { region } : {}) });
    index = last;
  }
  // The strongest dozen, in time order.
  return moments.sort((a, b) => b.peak - a.peak).slice(0, 12).sort((a, b) => a.start - b.start);
}

/** Exact colors at points and color edges along lines, in source pixels of one frame. */
async function readMeasure(path: string, directory: string, source: Source, work: Work, signal: AbortSignal): Promise<Result> {
  const [time] = timesIn(work.start, work.start, 1, source);
  const { data, info } = await sharp(await frameAt(path, directory, time, undefined, 'measure', signal)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { colors, edges } = measure({ data, width: info.width, height: info.height }, work);
  return { width: info.width, height: info.height, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps, 3), frames: [{ time }], colors, edges: edges?.map(edge => ({ ...edge, changes: strongEdges(edge.changes) })) };
}

/** Footage is textured: every grain of concrete is a small color step. Keep the jumps that stand out along the line, in order. */
function strongEdges(changes: { at: number; before: string; after: string }[]) {
  const jump = (change: { before: string; after: string }) => [1, 3, 5].reduce((sum, offset) => sum + Math.abs(parseInt(change.after.slice(offset, offset + 2), 16) - parseInt(change.before.slice(offset, offset + 2), 16)), 0);
  const strongest = Math.max(0, ...changes.map(jump));
  const kept = changes.filter(change => jump(change) >= Math.max(48, strongest * .4));
  return kept.length > 12 ? [...kept].sort((a, b) => jump(b) - jump(a)).slice(0, 12).sort((a, b) => a.at - b.at) : kept;
}

/** Follow one box from the first frame: position, size, scale and rotation per frame, plus a sheet with the box drawn. */
async function readTrack(path: string, directory: string, source: Source, work: Work, signal: AbortSignal, onProgress: (percent: number) => void): Promise<Result> {
  if (!work.box) throw new AnalysisError('Tracking needs a box around the object in the first frame.', 400);
  const box = clampBox(work.box, source), start = Math.min(work.start, Math.max(0, source.duration - .05)), end = Math.min(Math.max(work.end, start + .05), source.duration);
  const step = Math.max(1 / source.fps, (end - start) / 90), width = Math.min(640, source.width) & ~1, k = width / source.width, height = Math.round(source.height * k) & ~1;
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', path, '-map', '0:v:0', '-vf', `fps=${(1 / step).toFixed(4)},scale=${width}:${height},format=gray`, '-f', 'rawvideo', '-'], { signal, timeout: 120_000, encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024 });
  const frameSize = width * height, frameCount = Math.floor(stdout.length / frameSize);
  if (!frameCount) throw new AnalysisError('No frames could be read in that window.', 400);
  const frames = Array.from({ length: frameCount }, (_, index) => stdout.subarray(index * frameSize, (index + 1) * frameSize));
  // A box under about 40 px holds too little texture to tell a turn or a resize from noise: follow its position only.
  const w0 = box.w * k, h0 = box.h * k, rigid = Math.min(box.w, box.h) < 40;
  const poses = followBox({ frames, width, height }, { x: (box.x + box.w / 2) * k, y: (box.y + box.h / 2) * k, w: w0, h: h0 }, rigid, index => { if (index % 10 === 0) onProgress(10 + 60 * index / frameCount); });
  const track: NonNullable<Result['track']> = poses.map((pose, index) => {
    const w = w0 * pose.s / k, h = h0 * pose.s / k;
    return { time: round(start + index * step, 3), x: Math.round(pose.x / k - w / 2), y: Math.round(pose.y / k - h / 2), w: Math.round(w), h: Math.round(h), scale: round(pose.s, 3), rotation: round(pose.a * 180 / Math.PI, 1), confidence: round(Math.max(0, pose.value), 2) };
  });
  // The sheet: up to 8 tracked frames in color with the box drawn where it was found.
  const picks = [...new Set(Array.from({ length: Math.min(8, track.length) }, (_, index) => Math.round(index * (track.length - 1) / Math.max(1, Math.min(8, track.length) - 1))))];
  const images = await Promise.all(picks.map(index => frameAt(path, directory, track[index].time, undefined, `track-${index}`, signal)));
  onProgress(90);
  const tiles = picks.map((index, order) => {
    const item = track[index];
    return { image: images[order], label: `${index + 1}  ${item.time.toFixed(2)}s  ${item.rotation}°  ×${item.scale}  conf ${item.confidence}`, overlay: boxOverlay(item, source) };
  });
  const result = await sheet(tiles, source.width / source.height);
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps, 3), frames: picks.map(index => ({ time: track[index].time })), track, moves: fitMotion(track, source) };
}

/** A rotated box outline in tile coordinates ({w} and {h} are the tile size). */
function boxOverlay(item: { x: number; y: number; w: number; h: number; rotation: number }, source: Source) {
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  return `<svg viewBox="0 0 ${source.width} ${source.height}" width="{w}" height="{h}" preserveAspectRatio="none"><rect x="${item.x}" y="${item.y}" width="${item.w}" height="${item.h}" transform="rotate(${item.rotation} ${cx} ${cy})" fill="none" stroke="#3dd68c" stroke-width="${Math.max(3, source.width / 300)}"/></svg>`;
}

export async function readReference(path: string, directory: string, work: Work, signal: AbortSignal, onProgress: (percent: number) => void): Promise<Result> {
  const source = await probe(path, signal);
  if (work.end < work.start) throw new AnalysisError('The window ends before it starts.', 400);
  onProgress(5);
  if (work.mode === 'measure') return readMeasure(path, directory, source, work, signal);
  if (work.mode === 'track') return readTrack(path, directory, source, work, signal, onProgress);
  return readSheet(path, directory, source, work, signal, onProgress);
}
