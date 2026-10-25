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
// Person matting keeps soft hair edges; SAM 3 masks any named object (hard edges).
const PERSON_ENDPOINT = 'veed/video-background-removal', OBJECT_ENDPOINT = 'fal-ai/sam-3/video';
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;

/** Cut out the person (or the named `subject`) of source seconds [start, end) with fal.ai; returns a VP9 WebM with alpha.
 * Only the window is sent, because fal bills every frame it receives. */
export async function removeBackground(source: string, directory: string, window: { start: number; end: number; fps?: number; subject?: string }, signal: AbortSignal, onProgress: (value: number) => void) {
  const key = process.env.FAL_KEY;
  if (!key) throw new AnalysisError('Background removal is not configured on the media worker.', 503);
  const clip = join(directory, 'cutout-source.mp4');
  // fal bills per frame: never send more frames than the project plays.
  const { stdout: rate } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate', '-of', 'csv=p=0', source], { signal, timeout: 30_000 });
  const [num, den] = rate.trim().split('/').map(Number), sourceFps = den ? num / den : num;
  // A constant rate gives every frame a known time, whatever timing fal returns.
  const fps = Math.max(1, Math.min(window.fps ?? 30, Number.isFinite(sourceFps) && sourceFps > 0 ? Math.round(sourceFps) : 30));
  // Accurate seek from the prior keyframe; near-lossless H.264 so edges survive the hand-off.
  await run('ffmpeg', ['-v', 'error', '-threads', '2', '-ss', String(window.start), '-i', source, '-t', String(window.end - window.start), '-map', '0:v:0', '-an', '-vf', `fps=${fps}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-y', clip], { signal, timeout: 600_000, maxBuffer: 1024 * 1024 });
  onProgress(20);
  const fal = createFalClient({ credentials: key });
  const url = await fal.storage.upload(new Blob([await readFile(clip)], { type: 'video/mp4' }));
  signal.throwIfAborted();
  onProgress(30);
  const endpoint = window.subject ? OBJECT_ENDPOINT : PERSON_ENDPOINT;
  const input = window.subject
    ? { video_url: url, prompt: window.subject, apply_mask: true, video_output_type: 'VP9 (.webm)' }
    : { video_url: url, output_codec: 'vp9', refine_foreground_edges: true, subject_is_person: true };
  let requestId: string | undefined;
  let result;
  try {
    result = await fal.subscribe(endpoint, {
      input, pollInterval: 3000, abortSignal: signal,
      onEnqueue: id => { requestId = id; },
      onQueueUpdate: status => { if (status.status === 'IN_PROGRESS') onProgress(55); },
    });
  } catch (error) {
    // Stop the paid job too when the task is cancelled.
    if (signal.aborted && requestId) await fal.queue.cancel(endpoint, { requestId }).catch(() => {});
    throw signal.aborted ? error : new AnalysisError(`Background removal failed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`, 502);
  }
  // The person endpoint returns a list of videos, SAM 3 a single one.
  const video = (result.data as { video?: { url?: string } | { url?: string }[] }).video;
  const output = (Array.isArray(video) ? video[0] : video)?.url;
  if (!output) throw new AnalysisError('Background removal returned no video.', 502);
  onProgress(80);
  let path = join(directory, 'cutout.webm');
  const response = await fetch(output, { signal });
  if (!response.ok || !response.body) throw new AnalysisError(`Could not download the background-removed video (HTTP ${response.status}).`, 502);
  if (Number(response.headers.get('content-length') ?? 0) > MAX_OUTPUT_BYTES) throw new AnalysisError('The background-removed video is too large to store.', 400);
  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(path), { signal });
  onProgress(84);
  if (window.subject && !await anyOpaque(path, signal)) throw new AnalysisError(`No ${window.subject.slice(0, 60)} was found in this clip. Try a different word for it.`, 422);
  // fal may return different timestamps (or frame count) than it was sent. Output frame i
  // is input frame i, so retime frames onto the input's clock; if the count differs,
  // stretch to the input's exact duration. Then lead with transparent frames so second N
  // of the cut-out is second N of the source: the clip keeps its sourceStart and stays in
  // sync with its linked original audio.
  const sent = await frameCount(clip, signal), returned = await frameCount(path, signal);
  const retime = sent === returned ? `setpts=N/(${fps}*TB)` : `setpts=N*${sent / returned}/(${fps}*TB)`;
  const aligned = join(directory, 'cutout-aligned.webm');
  await run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', path, '-vf', `${retime},fps=${fps},format=yuva420p${window.start > 0 ? `,tpad=start_duration=${window.start}:start_mode=add:color=0x00000000` : ''}`, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', '-b:v', '0', '-crf', '18', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-an', '-y', aligned], { signal, timeout: 1_800_000, maxBuffer: 1024 * 1024 });
  path = aligned;
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type: string; codec_name: string; width?: number; height?: number }[] };
  const stream = probe.streams?.find(item => item.codec_type === 'video'), duration = Number(probe.format?.duration);
  if (!stream?.width || !stream.height || stream.codec_name !== 'vp9' || !Number.isFinite(duration) || duration <= 0) throw new AnalysisError('The background-removed video is unreadable.', 502);
  onProgress(90);
  return { path, duration, width: stream.width, height: stream.height };
}

async function frameCount(path: string, signal: AbortSignal) {
  // Packets equal frames for these single-stream H.264/VP9 files; counting them skips decoding.
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', path], { signal, timeout: 60_000 });
  const count = Number(stdout.trim());
  if (!Number.isInteger(count) || count < 1) throw new AnalysisError('The background-removed video has no frames.', 502);
  return count;
}

async function anyOpaque(path: string, signal: AbortSignal) {
  // SAM 3 returns a fully transparent video when nothing matches; a tiny alpha thumbnail per frame is enough to tell.
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-c:v', 'libvpx-vp9', '-i', path, '-vf', 'alphaextract,scale=32:32,format=gray', '-f', 'rawvideo', '-'], { signal, timeout: 600_000, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
  return stdout.some(value => value > 128);
}
