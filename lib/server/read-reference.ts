import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { MediaTaskResult, MediaWorkItem } from '@/convex/mediaTasks';
import { AnalysisError } from '@/lib/media-analysis/errors';
import { measure } from './blueprint-check';
import { forEachLimited } from './run-limited';

type Work = NonNullable<MediaWorkItem['read']>;
type Result = NonNullable<MediaTaskResult['read']>;
type Box = { x: number; y: number; w: number; h: number };
type Source = { width: number; height: number; fps: number; duration: number };

const run = promisify(execFile);
const SHEET_WIDTH = 1600, GAP = 8, LABEL = 30, MAX_IMAGE = 880_000;
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
  await run('ffmpeg', ['-v', 'error', '-ss', time.toFixed(3), '-i', path, '-map', '0:v:0', '-frames:v', '1', ...(crop ? ['-vf', `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : []), '-y', output], { signal, timeout: 30_000 });
  return readFile(output);
}

const clampBox = (box: Box, source: Source): Box => {
  const x = Math.max(0, Math.min(source.width - 2, Math.round(box.x))), y = Math.max(0, Math.min(source.height - 2, Math.round(box.y)));
  return { x, y, w: Math.max(2, Math.min(source.width - x, Math.round(box.w))), h: Math.max(2, Math.min(source.height - y, Math.round(box.h))) };
};
const timesIn = (start: number, end: number, count: number, source: Source) => {
  const last = Math.max(0, source.duration - 1 / source.fps), from = Math.min(start, last), to = Math.min(Math.max(end, from), last);
  return Array.from({ length: count }, (_, index) => round(count === 1 ? from : from + (to - from) * index / (count - 1), 3));
};
const escape = (text: string) => text.replace(/[<>&]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[char]!);

/** Tiles in a grid, each labeled under it, as one JPEG small enough to hand to a model. */
async function sheet(tiles: { image: Buffer; label: string; overlay?: string }[], aspect: number) {
  const columns = Math.min(4, tiles.length <= 4 ? tiles.length : Math.ceil(Math.sqrt(tiles.length)));
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
  const crop = work.crop ? clampBox(work.crop, source) : undefined, times = timesIn(work.start, work.end, Math.max(1, Math.min(16, work.count ?? 8)), source);
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
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps, 3), frames };
}

/** Exact colors at points and color edges along lines, in source pixels of one frame. */
async function readMeasure(path: string, directory: string, source: Source, work: Work, signal: AbortSignal): Promise<Result> {
  const [time] = timesIn(work.start, work.start, 1, source);
  const { data, info } = await sharp(await frameAt(path, directory, time, undefined, 'measure', signal)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps, 3), frames: [{ time }], ...measure({ data, width: info.width, height: info.height }, work) };
}

/** Normalized cross-correlation of the template against the frame, sampled through a scaled and rotated grid. */
function score(frame: Uint8Array, width: number, height: number, template: Float32Array, size: number, cx: number, cy: number, w: number, h: number, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let sum = 0, sumSq = 0, cross = 0, count = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = (i + .5) / size - .5, v = (j + .5) / size - .5, x = cx + u * w * cos - v * h * sin, y = cy + u * w * sin + v * h * cos;
    if (x < 0 || y < 0 || x >= width - 1 || y >= height - 1) return -1;
    const value = frame[(y | 0) * width + (x | 0)], t = template[j * size + i];
    sum += value; sumSq += value * value; cross += value * t; count++;
  }
  const mean = sum / count, variance = sumSq / count - mean * mean;
  // The template is zero-mean and unit-norm, so this is the correlation in -1..1.
  return variance < 1 ? 0 : cross / Math.sqrt(variance * count);
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
  // The template: the first frame's box on a fixed grid, zero-mean and unit-norm, so scores are correlations in -1..1.
  const size = 32, template = new Float32Array(size * size);
  const w0 = box.w * k, h0 = box.h * k;
  let cx = (box.x + box.w / 2) * k, cy = (box.y + box.h / 2) * k, scale = 1, angle = 0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) template[j * size + i] = frames[0][Math.min(height - 1, Math.round(cy + ((j + .5) / size - .5) * h0)) * width + Math.min(width - 1, Math.round(cx + ((i + .5) / size - .5) * w0))];
  const mean = template.reduce((sum, value) => sum + value, 0) / template.length;
  let norm = 0; for (let index = 0; index < template.length; index++) { template[index] -= mean; norm += template[index] ** 2; }
  norm = Math.sqrt(norm) || 1; for (let index = 0; index < template.length; index++) template[index] /= norm;
  const track: NonNullable<Result['track']> = [];
  for (let index = 0; index < frameCount; index++) {
    const frame = frames[index], at = (x: number, y: number, s: number, a: number) => score(frame, width, height, template, size, x, y, w0 * s, h0 * s, a);
    let best = { x: cx, y: cy, s: scale, a: angle, value: at(cx, cy, scale, angle) };
    if (index) {
      // Coarse: position only, around the last position. Fine: scale and rotation at the best position, then a 1px nudge.
      const reach = Math.max(8, Math.round(Math.max(w0, h0) * scale * .6));
      for (let dy = -reach; dy <= reach; dy += 2) for (let dx = -reach; dx <= reach; dx += 2) { const value = at(cx + dx, cy + dy, scale, angle); if (value > best.value) best = { x: cx + dx, y: cy + dy, s: scale, a: angle, value }; }
      for (const ds of [.94, .97, 1, 1.03, 1.06]) for (const da of [-6, -3, 0, 3, 6]) for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const s = best.s * ds, a = best.a + da * Math.PI / 180, value = at(best.x + dx, best.y + dy, s, a);
        if (value > best.value) best = { x: best.x + dx, y: best.y + dy, s, a, value };
      }
      ({ x: cx, y: cy, s: scale, a: angle } = best);
    }
    const w = w0 * scale / k, h = h0 * scale / k;
    track.push({ time: round(start + index * step, 3), x: Math.round(cx / k - w / 2), y: Math.round(cy / k - h / 2), w: Math.round(w), h: Math.round(h), scale: round(scale, 3), rotation: round(angle * 180 / Math.PI, 1), confidence: round(Math.max(0, best.value), 2) });
    if (index % 10 === 0) onProgress(10 + 60 * index / frameCount);
  }
  // The sheet: up to 8 tracked frames in color with the box drawn where it was found.
  const picks = [...new Set(Array.from({ length: Math.min(8, track.length) }, (_, index) => Math.round(index * (track.length - 1) / Math.max(1, Math.min(8, track.length) - 1))))];
  const images = await Promise.all(picks.map(index => frameAt(path, directory, track[index].time, undefined, `track-${index}`, signal)));
  onProgress(90);
  const tiles = picks.map((index, order) => {
    const item = track[index];
    return { image: images[order], label: `${index + 1}  ${item.time.toFixed(2)}s  ${item.rotation}°  ×${item.scale}  conf ${item.confidence}`, overlay: boxOverlay(item, source) };
  });
  const result = await sheet(tiles, source.width / source.height);
  return { ...result, sourceWidth: source.width, sourceHeight: source.height, fps: round(source.fps, 3), frames: picks.map(index => ({ time: track[index].time })), track };
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
