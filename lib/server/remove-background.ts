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
const ENDPOINT = 'veed/video-background-removal';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;

/** Cut out the subject of source seconds [start, end) with fal.ai; returns a VP9 WebM with alpha.
 * Only the window is sent, because fal bills every frame it receives. */
export async function removeBackground(source: string, directory: string, window: { start: number; end: number }, signal: AbortSignal, onProgress: (value: number) => void) {
  const key = process.env.FAL_KEY;
  if (!key) throw new AnalysisError('Background removal is not configured on the media worker.', 503);
  const clip = join(directory, 'cutout-source.mp4');
  // Accurate seek from the prior keyframe; near-lossless H.264 so edges survive the hand-off.
  await run('ffmpeg', ['-v', 'error', '-threads', '2', '-ss', String(window.start), '-i', source, '-t', String(window.end - window.start), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-y', clip], { signal, timeout: 600_000, maxBuffer: 1024 * 1024 });
  onProgress(20);
  const fal = createFalClient({ credentials: key });
  const url = await fal.storage.upload(new Blob([await readFile(clip)], { type: 'video/mp4' }));
  signal.throwIfAborted();
  onProgress(30);
  let requestId: string | undefined;
  let result;
  try {
    result = await fal.subscribe(ENDPOINT, {
      input: { video_url: url, output_codec: 'vp9', refine_foreground_edges: true, subject_is_person: true },
      pollInterval: 3000, abortSignal: signal,
      onEnqueue: id => { requestId = id; },
      onQueueUpdate: status => { if (status.status === 'IN_PROGRESS') onProgress(55); },
    });
  } catch (error) {
    // Stop the paid job too when the task is cancelled.
    if (signal.aborted && requestId) await fal.queue.cancel(ENDPOINT, { requestId }).catch(() => {});
    throw signal.aborted ? error : new AnalysisError(`Background removal failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`, 502);
  }
  const output = (result.data as { video?: { url?: string }[] }).video?.[0]?.url;
  if (!output) throw new AnalysisError('Background removal returned no video.', 502);
  onProgress(80);
  const path = join(directory, 'cutout.webm');
  const response = await fetch(output, { signal });
  if (!response.ok || !response.body) throw new AnalysisError(`Could not download the background-removed video (HTTP ${response.status}).`, 502);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_OUTPUT_BYTES) throw new AnalysisError('The background-removed video is too large to store.', 400);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(path), { signal });
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
  const video = probe.streams?.find(stream => stream.codec_type === 'video'), duration = Number(probe.format?.duration);
  if (!video?.width || !video.height || video.codec_name !== 'vp9' || !Number.isFinite(duration) || duration <= 0) throw new AnalysisError('The background-removed video is unreadable.', 502);
  onProgress(90);
  return { path, duration, width: video.width, height: video.height };
}
