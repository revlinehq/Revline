import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { measureAudioActivity } from './measure-audio-activity';

const run = promisify(execFile);

test('streams accurate 10ms quiet boundaries without cancelling opposite stereo channels', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'revline-activity-test-'));
  try {
    const source = join(directory, 'source.f32'), output = join(directory, 'source.wav');
    const samples = Buffer.alloc(3 * 16_000 * 2 * 4);
    for (let frame = 0; frame < 3 * 16_000; frame++) {
      const time = frame / 16_000, value = time >= .5 && time < 2 ? .25 * Math.sin(2 * Math.PI * 440 * time) : 0;
      samples.writeFloatLE(value, frame * 8); samples.writeFloatLE(-value, frame * 8 + 4);
    }
    await writeFile(source, samples);
    await run('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', '16000', '-ac', '2', '-i', source, '-c:a', 'pcm_f32le', '-y', output]);
    const activity = await measureAudioActivity(output, AbortSignal.timeout(10_000));
    expect(activity.frameSeconds).toBe(.01);
    expect(activity.duration).toBe(3);
    expect(activity.reliable).toBe(true);
    expect(activity.quiet).toEqual([{ start: 0, end: .5 }, { start: 2, end: 3 }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 15_000);

test('keeps a delayed audio stream on its source timeline', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'revline-activity-delay-test-'));
  try {
    const source = join(directory, 'source.f32'), output = join(directory, 'source.m4a');
    const samples = Buffer.alloc(16_000 * 4);
    for (let frame = 0; frame < 16_000; frame++) samples.writeFloatLE(.25 * Math.sin(2 * Math.PI * 440 * frame / 16_000), frame * 4);
    await writeFile(source, samples);
    await run('ffmpeg', ['-v', 'error', '-f', 'f32le', '-ar', '16000', '-ac', '1', '-i', source, '-af', 'asetpts=PTS+0.5/TB', '-c:a', 'aac', '-y', output]);
    const activity = await measureAudioActivity(output, AbortSignal.timeout(10_000));
    expect(activity.duration).toBeGreaterThan(1.45);
    expect(activity.duration).toBeLessThan(1.6);
    expect(activity.quiet[0].start).toBe(0);
    // AAC priming can contain tiny pre-echo before the .5s tone. The detector
    // keeps it conservatively while retaining the stream's .436s PTS gap.
    expect(activity.quiet[0].end).toBeGreaterThanOrEqual(.42);
    expect(activity.quiet[0].end).toBeLessThanOrEqual(.51);
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 15_000);

test('honors cancellation before decoding', async () => {
  await expect(measureAudioActivity('unused.wav', AbortSignal.abort())).rejects.toThrow();
});
