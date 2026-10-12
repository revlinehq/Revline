import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { measureAudioWaveform } from './audio-waveform';

it('measures silence and changing levels without cancelling opposite stereo channels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'revline-wave-test-'));
  try {
    const input = join(directory, 'source.f32'), output = join(directory, 'source.wav');
    const samples = Buffer.alloc(3 * 48_000 * 2 * 4);
    for (let frame = 0; frame < 3 * 48_000; frame++) {
      const time = frame / 48_000;
      const value = (time < 1 ? 0 : time < 2 ? .25 : .75) * Math.sin(2 * Math.PI * 440 * time);
      samples.writeFloatLE(value, frame * 8); samples.writeFloatLE(-value, frame * 8 + 4);
    }
    await writeFile(input, samples);
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', '48000', '-ac', '2', '-i', input, '-c:a', 'pcm_f32le', '-y', output]);
    const waveform = await measureAudioWaveform(output, AbortSignal.timeout(10_000));
    const peaks = Buffer.from(waveform.peaks, 'base64');
    expect(waveform.samplesPerSecond).toBe(100);
    expect(peaks).toHaveLength(300);
    expect([...peaks.subarray(0, 100)].every(value => value === 0)).toBe(true);
    expect(peaks[150]).toBeCloseTo(64, 0);
    expect(peaks[250]).toBeCloseTo(191, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 15_000);
