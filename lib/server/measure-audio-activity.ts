import { mediaInputOptions } from './media-command';
import { runMediaCommand as run } from './media-command';
import { spawn } from 'node:child_process';
import { analyzeAudioActivity, AUDIO_ACTIVITY_FRAME_SECONDS, MAX_AUDIO_ACTIVITY_DURATION, type AudioActivity, type AudioEnergyFrames } from '@/lib/media-analysis/audio-activity';
import type { Transcript } from '@/lib/media-analysis/transcript';

const SAMPLE_RATE = 16_000;
const FRAME_SAMPLES = SAMPLE_RATE * AUDIO_ACTIVITY_FRAME_SECONDS;

/** Stream bounded PCM; preserve source-time gaps and avoid stereo phase cancellation. */
export async function measureAudioActivity(input: string, signal: AbortSignal, transcript?: Transcript): Promise<AudioActivity> {
  const { frames, duration } = await measureAudioEnergy(input, signal);
  return analyzeAudioActivity(frames, duration, transcript);
}

/** 10ms RMS and peak levels in source time, shared by activity and speech windowing. */
async function measureAudioEnergy(input: string, signal: AbortSignal): Promise<{ frames: AudioEnergyFrames; duration: number }> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,start_time:format=duration', '-of', 'json', input], { signal, timeout: 30_000, maxBuffer: 1024 * 1024 });
  const probe = JSON.parse(stdout) as { streams?: { channels?: number; start_time?: string }[]; format?: { duration?: string } };
  const duration = Number(probe.format?.duration), channels = probe.streams?.[0]?.channels ?? 0;
  const start = Number(probe.streams?.[0]?.start_time ?? 0);
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_AUDIO_ACTIVITY_DURATION || !Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isFinite(start) || start > duration) throw new Error('Could not measure the audio activity duration or channels.');
  // Some audio containers report stream length rather than the absolute final
  // PTS as format duration. Reserve its delayed start before filling PTS gaps.
  const capacity = Math.min(Math.ceil(MAX_AUDIO_ACTIVITY_DURATION / AUDIO_ACTIVITY_FRAME_SECONDS), Math.ceil((duration + Math.max(0, start) + .1) / AUDIO_ACTIVITY_FRAME_SECONDS));
  const rmsDb = new Float32Array(capacity), peakDb = new Float32Array(capacity);
  let frameCount = 0, sampleCount = 0, frameSampleCount = 0;
  const sums = new Float64Array(channels), peaks = new Float64Array(channels);
  const flush = () => {
    if (frameCount >= capacity) throw new Error('The decoded audio exceeds its measured duration.');
    let rms = 0, peak = 0;
    for (let channel = 0; channel < channels; channel++) { rms = Math.max(rms, Math.sqrt(sums[channel] / frameSampleCount)); peak = Math.max(peak, peaks[channel]); }
    rmsDb[frameCount] = 20 * Math.log10(Math.max(1e-6, rms));
    peakDb[frameCount] = 20 * Math.log10(Math.max(1e-6, peak));
    frameCount++; frameSampleCount = 0; sums.fill(0); peaks.fill(0);
  };
  const child = spawn('ffmpeg', ['-v', 'error', '-copyts', ...mediaInputOptions(input), '-i', input, '-map', '0:a:0', '-vn', '-af', `aresample=${SAMPLE_RATE}:async=1:first_pts=0`, '-acodec', 'pcm_f32le', '-f', 'f32le', '-'], { signal, timeout: /^https?:\/\//.test(input) ? undefined : 180_000, stdio: ['ignore', 'pipe', 'pipe'] });
  let errorOutput = '', childError: Error | undefined;
  child.stderr.on('data', (chunk: Buffer) => { if (errorOutput.length < 4096) errorOutput += chunk.toString().slice(0, 4096 - errorOutput.length); });
  // Register immediately: spawn errors or aborts can precede stream iteration.
  const completion = new Promise<void>((resolve, reject) => {
    child.once('error', error => { childError = error; });
    child.once('close', code => code === 0 && !childError ? resolve() : reject(childError ?? new Error(`Could not decode audio activity: ${errorOutput.trim() || `ffmpeg exited ${code}`}`)));
  });
  // The stream and process are awaited together below; prevent an early
  // rejection from becoming unhandled while PCM is still being consumed.
  void completion.catch(() => {});
  let remainder = Buffer.alloc(0);
  try {
    const stride = channels * 4;
    for await (const raw of child.stdout) {
      const chunk = remainder.length ? Buffer.concat([remainder, raw as Buffer]) : raw as Buffer;
      const bytes = chunk.length - chunk.length % stride;
      for (let offset = 0; offset < bytes; offset += stride) {
        for (let channel = 0; channel < channels; channel++) {
          const value = chunk.readFloatLE(offset + channel * 4);
          if (!Number.isFinite(value)) throw new Error('The decoded audio contains invalid samples.');
          sums[channel] += value * value; peaks[channel] = Math.max(peaks[channel], Math.abs(value));
        }
        sampleCount++; frameSampleCount++;
        if (frameSampleCount === FRAME_SAMPLES) flush();
      }
      remainder = Buffer.from(chunk.subarray(bytes));
    }
    await completion;
    if (remainder.length || !sampleCount) throw new Error('Could not decode complete audio activity samples.');
    if (frameSampleCount) flush();
    return { frames: { rmsDb: rmsDb.subarray(0, frameCount), peakDb: peakDb.subarray(0, frameCount) }, duration: sampleCount / SAMPLE_RATE };
  } catch (error) {
    child.kill('SIGKILL');
    await completion.catch(() => {});
    throw error;
  }
}
