import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { downloadOwnedMedia } from '../server/owned-media';

const run = promisify(execFile);

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

export async function prepareVideo(input: string, output: string, signal: AbortSignal) {
  // Compatibility conversion for unsupported containers; preserve source motion and framing.
  const geometry = "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setpts=PTS-STARTPTS";
  await run('ffmpeg', ['-v', 'error', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-vf', geometry, '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', output], { signal, timeout: 90_000, maxBuffer: 1024 * 1024 });
}
