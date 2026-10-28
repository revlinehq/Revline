import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createFalClient } from '@fal-ai/client';
import { AnalysisError } from '@/lib/media-analysis/errors';

const run = promisify(execFile);
const RIFE_ENDPOINT = 'fal-ai/rife/video', VIDEO_UPSCALE_ENDPOINT = 'fal-ai/video-upscaler', IMAGE_UPSCALE_ENDPOINT = 'fal-ai/seedvr/upscale/image';
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024 * 1024;
export type DeriveRequest = { op: 'freeze' | 'slowmo' | 'upscale'; start: number; end: number; time?: number; factor?: number; target?: number };
export type DerivedFile = { path: string; kind: 'video' | 'image'; contentType: string; width: number; height: number; duration?: number };

/** Make the requested copy of `source` (a video or image file) in `directory`. */
export async function deriveMedia(source: string, kind: 'video' | 'image', directory: string, request: DeriveRequest, signal: AbortSignal, onProgress: (value: number) => void): Promise<DerivedFile> {
  if (request.op === 'freeze') return freezeStill(source, directory, request.time ?? request.start, signal);
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
  const first = Math.ceil(Math.sqrt(total));
  return [first, Math.ceil(total / first)];
}

async function freezeStill(source: string, directory: string, time: number, signal: AbortSignal): Promise<DerivedFile> {
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

async function subscribe(fal: ReturnType<typeof createFalClient>, endpoint: string, input: Record<string, unknown>, signal: AbortSignal) {
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

async function download(url: string, path: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new AnalysisError(`Could not download the processed media (HTTP ${response.status}).`, 502);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_OUTPUT_BYTES) throw new AnalysisError('The processed media is too large to store.', 400);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(path), { signal });
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
