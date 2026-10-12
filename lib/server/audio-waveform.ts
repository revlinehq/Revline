import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AudioWaveform } from '@/lib/editor/types';

const run = promisify(execFile);
/** Peak amplitude across every channel, in bounded source-time buckets. */
export async function measureAudioWaveform(input: string, signal: AbortSignal): Promise<AudioWaveform> {
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', input], { signal, timeout: 30_000 });
  const duration = Number(JSON.parse(probe.stdout).format?.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86_401) throw new Error('Could not measure the audio duration.');
  const bucket = Math.max(480, Math.ceil(48_000 * duration / 12_000));
  const filter = `aresample=48000,asetnsamples=n=${bucket}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=Peak_level,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=-`;
  const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', input, '-map', '0:a:0', '-vn', '-af', filter, '-f', 'null', '-'], { signal, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  const peaks = [...stdout.matchAll(/lavfi\.astats\.Overall\.Peak_level=([^\r\n]+)/g)].map(match => {
    const db = Number(match[1]);
    return Number.isFinite(db) ? Math.round(Math.min(1, 10 ** (db / 20)) * 255) : 0;
  });
  if (!peaks.length || peaks.length > 12_100) throw new Error('Could not measure the audio waveform.');
  return { peaks: Buffer.from(peaks).toString('base64'), samplesPerSecond: 48_000 / bucket };
}
