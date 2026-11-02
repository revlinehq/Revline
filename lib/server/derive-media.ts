import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createFalClient } from '@fal-ai/client';
import { freezeParallax } from './freeze-parallax';
import { AnalysisError } from '@/lib/media-analysis/errors';

const run = promisify(execFile);
const RIFE_ENDPOINT = 'fal-ai/rife/video', VIDEO_UPSCALE_ENDPOINT = 'fal-ai/video-upscaler', IMAGE_UPSCALE_ENDPOINT = 'fal-ai/seedvr/upscale/image';
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
export type DeriveRequest = { op: 'freeze' | 'slowmo' | 'upscale' | 'stats' | 'parallax'; start: number; end: number; time?: number; times?: number[]; factor?: number; target?: number; backgroundPrompt?: string };
export type DerivedFile = { path: string; kind: 'video' | 'image'; contentType: string; width: number; height: number; duration?: number };

/** Make the requested copy of `source` (a video or image file) in `directory`. */
export async function deriveMedia(source: string, kind: 'video' | 'image', directory: string, request: DeriveRequest, signal: AbortSignal, onProgress: (value: number) => void): Promise<DerivedFile> {
  if (request.op === 'freeze') return freezeStill(source, directory, request.time ?? request.start, signal);
  if (request.op === 'parallax') return freezeParallax(source, kind, directory, request.time ?? request.start, request.backgroundPrompt, signal, onProgress);
  const key = process.env.FAL_KEY;
  if (!key) throw new AnalysisError('AI video processing is not configured on the media worker.', 503);
  const fal = createFalClient({ credentials: key });
  if (request.op === 'upscale' && kind === 'image') return upscaleImage(fal, source, directory, request.target ?? 1080, signal, onProgress);
  const probe = await videoInfo(source, signal), fps = Math.min(60, Math.max(1, Math.round(probe.fps || 30)));
  // Only the window goes to fal, which bills by the work it does.
  const clip = join(directory, 'derive-source.mp4');
  await run('ffmpeg', ['-v', 'error', '-threads', '2', '-ss', request.start.toFixed(6), '-i', source, '-t', (request.end - request.start).toFixed(6), '-map', '0:v:0', '-an', '-vf', `fps=${fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-y', clip], { signal, timeout: 600_000, maxBuffer: 1024 * 1024 });
  onProgress(15);
  let current = clip, outputFps = fps;
  if (request.op === 'slowmo') {
    // RIFE inserts 1 to 4 frames per gap; two passes reach up to 8x.
    const passes = factorPasses(request.factor ?? 2);
    for (const [index, factor] of passes.entries()) {
      current = await falVideo(fal, RIFE_ENDPOINT, { num_frames: factor - 1, use_calculated_fps: true, use_scene_detection: true }, current, join(directory, `rife-${index}.mp4`), signal);
      outputFps *= factor;
      onProgress(15 + Math.round(60 * (index + 1) / passes.length));
    }
  } else {
    const scale = Math.min(4, Math.max(1.1, (request.target ?? 1080) / Math.min(probe.width, probe.height)));
    current = await falVideo(fal, VIDEO_UPSCALE_ENDPOINT, { scale: Math.round(scale * 100) / 100 }, current, join(directory, 'upscaled.mp4'), signal);
    onProgress(75);
  }
  // fal may return different timing (or frame count) than it was sent. Spread the frames evenly over the
  // window, then lead with black so second N of the copy is second N of the source.
  const sent = await frameCount(clip, signal), returned = await frameCount(current, signal), expected = Math.round(sent * outputFps / fps);
  const retime = `setpts=N*${expected / returned}/(${outputFps}*TB)`;
  const aligned = join(directory, 'derived.mp4');
  const pad = request.start > 0 ? `,tpad=start_duration=${request.start}:start_mode=add:color=black` : '';
  await run('ffmpeg', ['-v', 'error', '-i', current, '-vf', `${retime},fps=${outputFps},format=yuv420p${pad}`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', aligned], { signal, timeout: 3_600_000, maxBuffer: 1024 * 1024 });
  const info = await videoInfo(aligned, signal);
  if (!info.width || !info.height || !(info.duration > 0)) throw new AnalysisError('The processed video is unreadable.', 502);
  onProgress(92);
  return { path: aligned, kind: 'video', contentType: 'video/mp4', width: info.width, height: info.height, duration: info.duration };
}

/** Split a frame multiplier into RIFE passes of 2 to 5x. */
export function factorPasses(factor: number) {
  const total = Math.max(2, Math.min(8, Math.round(factor)));
  if (total <= 5) return [total];
  return [2, Math.ceil(total / 2)];
}

export async function freezeStill(source: string, directory: string, time: number, signal: AbortSignal): Promise<DerivedFile> {
  const probe = await videoInfo(source, signal);
  // Cut-outs keep their transparency as PNG; other footage becomes a high-quality JPEG.
  const alpha = probe.codec === 'vp9' || probe.codec === 'vp8';
  const path = join(directory, alpha ? 'freeze.png' : 'freeze.jpg');
  const seek = Math.max(0, Math.min(time, Math.max(0, probe.duration - 1 / Math.max(1, probe.fps || 30))));
  await run('ffmpeg', ['-v', 'error', ...(alpha ? ['-c:v', probe.codec === 'vp9' ? 'libvpx-vp9' : 'libvpx'] : []), '-ss', seek.toFixed(6), '-i', source, '-frames:v', '1', ...(alpha ? ['-pix_fmt', 'rgba'] : ['-q:v', '2']), '-y', path], { signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
  const info = await videoInfo(path, signal);
  if (!info.width || !info.height) throw new AnalysisError('The freeze frame could not be read from this video.', 422);
  return { path, kind: 'image', contentType: alpha ? 'image/png' : 'image/jpeg', width: info.width, height: info.height };
}

async function upscaleImage(fal: ReturnType<typeof createFalClient>, source: string, directory: string, target: number, signal: AbortSignal, onProgress: (value: number) => void): Promise<DerivedFile> {
  const resolution = target >= 2160 ? '2160p' : target >= 1440 ? '1440p' : '1080p';
  const url = await fal.storage.upload(new Blob([await readFile(source)]));
  onProgress(30);
  const result = await subscribe(fal, IMAGE_UPSCALE_ENDPOINT, { image_url: url, upscale_mode: 'target', target_resolution: resolution, output_format: 'png' }, signal);
  const output = (result as { image?: { url?: string } }).image?.url;
  if (!output) throw new AnalysisError('The upscaler returned no image.', 502);
  const path = join(directory, 'upscaled.png');
  await download(output, path, signal);
  const info = await videoInfo(path, signal);
  if (!info.width || !info.height) throw new AnalysisError('The upscaled image is unreadable.', 502);
  onProgress(90);
  return { path, kind: 'image', contentType: 'image/png', width: info.width, height: info.height };
}

async function falVideo(fal: ReturnType<typeof createFalClient>, endpoint: string, input: Record<string, unknown>, path: string, output: string, signal: AbortSignal) {
  const url = await fal.storage.upload(new Blob([await readFile(path)], { type: 'video/mp4' }));
  signal.throwIfAborted();
  const result = await subscribe(fal, endpoint, { ...input, video_url: url }, signal);
  const video = (result as { video?: { url?: string } }).video?.url;
  if (!video) throw new AnalysisError('AI video processing returned no video.', 502);
  await download(video, output, signal);
  return output;
}

export async function subscribe(fal: ReturnType<typeof createFalClient>, endpoint: string, input: Record<string, unknown>, signal: AbortSignal) {
  let requestId: string | undefined;
  try {
    const result = await fal.subscribe(endpoint, { input, pollInterval: 3000, abortSignal: signal, onEnqueue: id => { requestId = id; } });
    return result.data;
  } catch (error) {
    // Stop the paid job too when the task is cancelled.
    if (signal.aborted && requestId) await fal.queue.cancel(endpoint, { requestId }).catch(() => {});
    throw signal.aborted ? error : new AnalysisError(`AI video processing failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`, 502);
  }
}

export async function download(url: string, path: string, signal: AbortSignal, maxBytes = MAX_OUTPUT_BYTES) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new AnalysisError(`Could not download the processed media (HTTP ${response.status}).`, 502);
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new AnalysisError('The processed media is too large to store.', 400);
  let bytes = 0;
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, done) { bytes += chunk.length; done(bytes > maxBytes ? new AnalysisError('The processed media is too large to store.', 400) : null, chunk); } });
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), bounded, createWriteStream(path), { signal });
}

async function videoInfo(path: string, signal: AbortSignal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as { streams?: { codec_name?: string; width?: number; height?: number; avg_frame_rate?: string }[]; format?: { duration?: string } };
  const stream = probe.streams?.[0], [num, den] = (stream?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { codec: stream?.codec_name ?? '', width: stream?.width ?? 0, height: stream?.height ?? 0, fps: den ? num / den : 0, duration: Number(probe.format?.duration) || 0 };
}

async function frameCount(path: string, signal: AbortSignal) {
  // Packets equal frames for these single-stream H.264 files; counting them skips decoding.
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', path], { signal, timeout: 60_000 });
  const count = Number(stdout.trim());
  if (!Number.isInteger(count) || count < 1) throw new AnalysisError('The processed video has no frames.', 502);
  return count;
}

export type ColorStats = { time: number; percentiles: { red: number[]; green: number[]; blue: number[]; luma: number[] }; saturation: number; cast: { warmth: number; tint: number }; dominant: { hex: string; share: number }[] };
export const STAT_PERCENTILES = [.02, .1, .25, .5, .75, .9, .98];

/** Measure color at source times: per-channel percentiles, saturation, neutral cast and dominant colors. */
export async function measureColor(source: string, kind: 'video' | 'image', times: number[], signal: AbortSignal): Promise<ColorStats[]> {
  const probe = await videoInfo(source, signal), out: ColorStats[] = [];
  for (const time of kind === 'image' ? [0] : times) {
    const seek = Math.max(0, Math.min(time, Math.max(0, probe.duration - .05)));
    const { stdout } = await run('ffmpeg', ['-v', 'error', ...(kind === 'video' ? ['-ss', seek.toFixed(4)] : []), '-i', source, '-frames:v', '1', '-vf', 'scale=160:-2:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { signal, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' }) as unknown as { stdout: Buffer };
    if (stdout.length < 300) throw new AnalysisError('Could not read a frame to measure color.', 422);
    const count = Math.floor(stdout.length / 3), red: number[] = [], green: number[] = [], blue: number[] = [], luma: number[] = [];
    let saturation = 0, neutral = 0, neutralR = 0, neutralG = 0, neutralB = 0;
    const pixels: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
      const r = stdout[i * 3] / 255, g = stdout[i * 3 + 1] / 255, b = stdout[i * 3 + 2] / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = .2126 * r + .7152 * g + .0722 * b;
      red.push(r); green.push(g); blue.push(b); luma.push(l); pixels.push([r, g, b]);
      const s = max > 0 ? (max - min) / max : 0; saturation += s;
      // Near-neutral midtones reveal the light's color cast.
      if (s < .3 && l > .15 && l < .9) { neutral++; neutralR += r; neutralG += g; neutralB += b; }
    }
    const pick = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return STAT_PERCENTILES.map(p => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 1000) / 1000); };
    const nr = neutral ? neutralR / neutral : 0, ng = neutral ? neutralG / neutral : 0, nb = neutral ? neutralB / neutral : 0;
    out.push({ time, percentiles: { red: pick(red), green: pick(green), blue: pick(blue), luma: pick(luma) }, saturation: Math.round(saturation / count * 1000) / 1000,
      cast: { warmth: Math.round((nr - nb) * 1000) / 1000, tint: Math.round((ng - (nr + nb) / 2) * 1000) / 1000 }, dominant: dominantColors(pixels) });
  }
  return out;
}

/** k-means (k=5) over the frame's pixels; returns hex colors with their share of the frame. */
function dominantColors(pixels: [number, number, number][]) {
  const k = 5, step = Math.max(1, Math.floor(pixels.length / k));
  let centers = Array.from({ length: k }, (_, index) => pixels[Math.min(pixels.length - 1, index * step + Math.floor(step / 2))]);
  let assignment = new Array<number>(pixels.length).fill(0);
  for (let iteration = 0; iteration < 12; iteration++) {
    assignment = pixels.map(pixel => { let best = 0, distance = Infinity; centers.forEach((center, index) => { const d = (pixel[0] - center[0]) ** 2 + (pixel[1] - center[1]) ** 2 + (pixel[2] - center[2]) ** 2; if (d < distance) { distance = d; best = index; } }); return best; });
    centers = centers.map((center, index) => { const members = pixels.filter((_, i) => assignment[i] === index); return members.length ? [0, 1, 2].map(channel => members.reduce((sum, pixel) => sum + pixel[channel], 0) / members.length) as [number, number, number] : center; });
  }
  const hex = (color: [number, number, number]) => `#${color.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
  return centers.map((center, index) => ({ hex: hex(center), share: Math.round(assignment.filter(value => value === index).length / pixels.length * 1000) / 1000 })).filter(item => item.share > 0).sort((a, b) => b.share - a.share);
}
