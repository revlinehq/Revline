import { runMediaCommand as run } from './media-command';
import { join } from 'node:path';
import { AnalysisError } from '@/lib/media-analysis/errors';

export type DerivedFile = { path: string; kind: 'video' | 'image'; contentType: string; width: number; height: number; duration?: number };

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

export async function videoInfo(path: string, signal: AbortSignal) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', path], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as { streams?: { codec_name?: string; width?: number; height?: number; avg_frame_rate?: string }[]; format?: { duration?: string } };
  const stream = probe.streams?.[0], [num, den] = (stream?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { codec: stream?.codec_name ?? '', width: stream?.width ?? 0, height: stream?.height ?? 0, fps: den ? num / den : 0, duration: Number(probe.format?.duration) || 0 };
}
