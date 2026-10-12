import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export { downloadOwnedMedia } from '../server/owned-media';

const run = promisify(execFile);
export const MAX_ANALYSIS_SECONDS = 300;

export async function probeMedia(path: string, signal: AbortSignal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const value = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  const duration = Number(value.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('The source file has no readable duration.');
  if (duration > MAX_ANALYSIS_SECONDS) throw new Error('Media analysis supports source files up to five minutes long.');
  return { duration, hasAudio: !!value.streams?.some(stream => stream.codec_type === 'audio'), hasVideo: !!value.streams?.some(stream => stream.codec_type === 'video') };
}

export async function extractSpeechAudio(input: string, output: string, signal: AbortSignal) {
  await run('ffmpeg', ['-v', 'error', '-i', input, '-t', String(MAX_ANALYSIS_SECONDS), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', output], { signal, timeout: 60_000, maxBuffer: 1024 * 1024 });
}

export async function extractPcm(input: string, signal: AbortSignal) {
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', input, '-t', String(MAX_ANALYSIS_SECONDS), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-'], { signal, timeout: 60_000, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  const samples = new Float32Array(stdout.length / 4);
  for (let index = 0; index < samples.length; index++) samples[index] = stdout.readFloatLE(index * 4);
  return samples;
}

export async function prepareVideo(input: string, output: string, signal: AbortSignal) {
  // Pegasus requires both dimensions >=360 and an aspect ratio within 2.4:1.
  const geometry = "scale=720:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=w='max(360,max(iw,ceil(ih/2.4/2)*2))':h='max(360,max(ih,ceil(iw/2.4/2)*2))':x=(ow-iw)/2:y=(oh-ih)/2,setpts=PTS-STARTPTS,fps=24";
  await run('ffmpeg', ['-v', 'error', '-i', input, '-t', String(MAX_ANALYSIS_SECONDS), '-map', '0:v:0', '-map', '0:a:0?', '-vf', geometry, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-y', output], { signal, timeout: 90_000, maxBuffer: 1024 * 1024 });
}
