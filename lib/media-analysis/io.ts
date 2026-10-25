import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { downloadOwnedMedia } from '../server/owned-media';

const run = promisify(execFile);
export type AnalysisVideoPurpose = 'overview' | 'inspection';
const analysisProfiles = {
  overview: { maxEdge: 960, crf: 26, videoKbps: 1500, audioKbps: 96 },
  inspection: { maxEdge: 1280, crf: 23, videoKbps: 3000, audioKbps: 128 },
} as const;

export function needsAnalysisVideoProxy(source: { size: number; width?: number; height?: number }, duration: number, purpose: AnalysisVideoPurpose) {
  // Small and already efficient native files do not justify another encode.
  if (source.size <= 16 * 1024 * 1024) return false;
  const profile = analysisProfiles[purpose];
  return Math.max(source.width ?? 0, source.height ?? 0) > profile.maxEdge
    || source.size * 8 / duration > (profile.videoKbps + profile.audioKbps) * 1000 * 1.25;
}

export async function probeMedia(path: string, signal: AbortSignal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const value = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  const duration = Number(value.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source file has no readable duration.');
  return { duration, hasAudio: !!value.streams?.some(stream => stream.codec_type === 'audio'), hasVideo: !!value.streams?.some(stream => stream.codec_type === 'video') };
}

export async function extractSpeechAudio(input: string, output: string, signal: AbortSignal) {
  await run('ffmpeg', ['-v', 'error', '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
}

export async function extractTranscriptionAudio(input: string, output: string, signal: AbortSignal, window?: { start: number; end: number }) {
  const seek = window ? ['-ss', String(window.start)] : [];
  const length = window ? ['-t', String(window.end - window.start)] : [];
  await run('ffmpeg', ['-v', 'error', ...seek, '-i', input, ...length, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', '-y', output], { signal, timeout: 120_000, maxBuffer: 1024 * 1024 });
}

/** Encode only the asked source window for a video question, at the inspection
 * profile. Gemini then watches seconds, not the whole upload; times in its answer
 * are relative to the window start. Accurate input seeking decodes from the
 * prior keyframe, so the window starts exactly at `start`. */
export async function extractVideoWindow(input: string, output: string, start: number, end: number, signal: AbortSignal) {
  const profile = analysisProfiles.inspection;
  const geometry = `scale=w='min(${profile.maxEdge},iw)':h='min(${profile.maxEdge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  await run('ffmpeg', ['-v', 'error', '-threads', '2', '-ss', String(start), '-i', input, '-t', String(end - start), '-map', '0:v:0', '-map', '0:a:0?', '-vf', geometry, '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', String(profile.crf), '-maxrate', `${profile.videoKbps}k`, '-bufsize', `${profile.videoKbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${profile.audioKbps}k`, '-movflags', '+faststart', '-y', output], { signal, timeout: 600_000, maxBuffer: 1024 * 1024 });
}

export async function prepareVideo(input: string, output: string, signal: AbortSignal, purpose?: AnalysisVideoPurpose) {
  const profile = purpose ? analysisProfiles[purpose] : { maxEdge: 1280, crf: 24, audioKbps: 128 };
  // Bound transfer size through resolution/bitrate, retaining every recorded frame,
  // the complete source timeline and its audio. No static FPS sampling or crop.
  // FFmpeg normalizes the common input start. Resetting only video PTS here
  // would erase a real audio/video start offset and shift visual evidence.
  const geometry = `scale=w='min(${profile.maxEdge},iw)':h='min(${profile.maxEdge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;
  const bitrate = 'videoKbps' in profile ? ['-maxrate', `${profile.videoKbps}k`, '-bufsize', `${profile.videoKbps * 2}k`] : [];
  await run('ffmpeg', ['-v', 'error', '-threads', '2', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', geometry, '-fps_mode', 'vfr', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-crf', String(profile.crf), ...bitrate, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${profile.audioKbps}k`, '-movflags', '+faststart', '-y', output], { signal, timeout: purpose ? 600_000 : 90_000, maxBuffer: 1024 * 1024 });
}
