import { afterAll, beforeAll, expect, test } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractSpeechAudio, extractTranscriptionAudio, prepareVideo, probeMedia } from './io';
const run = promisify(execFile);
let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'revline-proxy-test-')); });
afterAll(async () => { await rm(directory, { force: true, recursive: true }); });
test.each([{ size: '180x320', width: 180, height: 320 }, { size: '600x100', width: 600, height: 100 }, { size: '100x600', width: 100, height: 600 }])('converts $size without changing its framing, duration or recorded frame rate', async ({ size, width, height }) => {
  const source = join(directory, `source-${size}.mp4`), proxy = join(directory, `proxy-${size}.mp4`);
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=red:s=${size}:r=30:d=1`, '-c:v', 'libx264', '-y', source]);
  await prepareVideo(source, proxy, AbortSignal.timeout(5000));
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,duration,start_time,avg_frame_rate', '-of', 'json', proxy]);
  const stream = JSON.parse(stdout).streams[0];
  expect(stream.width).toBe(width); expect(stream.height).toBe(height);
  expect(stream.avg_frame_rate).toBe('30/1');
  expect(Number(stream.duration)).toBeCloseTo(1, 2); expect(Number(stream.start_time)).toBe(0);
});

test('compresses an 18.6-minute source for Whisper without truncating it and supports exact source windows', async () => {
  const source = join(directory, 'eighteen-minute.m4a'), speech = join(directory, 'eighteen-minute.mp3'), window = join(directory, 'speech-window.mp3');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1116', '-c:a', 'aac', '-y', source]);
  const signal = AbortSignal.timeout(20_000);
  await extractTranscriptionAudio(source, speech, signal);
  expect((await stat(speech)).size).toBeLessThan(5_000_000);
  expect((await probeMedia(speech, signal)).duration).toBeCloseTo(1116, 0);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=sample_rate,channels,codec_name', '-of', 'json', speech]);
  expect(JSON.parse(stdout).streams[0]).toMatchObject({ sample_rate: '16000', channels: 1, codec_name: 'mp3' });
  await extractTranscriptionAudio(source, window, signal, { start: 600, end: 602 });
  expect((await probeMedia(window, signal)).duration).toBeCloseTo(2, 0);
}, 30_000);

test('a source longer than five minutes keeps its full duration through metadata and speech/video preparation', async () => {
  const source = join(directory, 'long-source.mp4'), proxy = join(directory, 'long-proxy.mp4'), speech = join(directory, 'long-speech.wav');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=16x16:r=1:d=301', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '301', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', source]);
  const signal = AbortSignal.timeout(10_000);
  expect((await probeMedia(source, signal)).duration).toBeCloseTo(301, 1);
  await prepareVideo(source, proxy, signal); await extractSpeechAudio(source, speech, signal);
  // AAC packet padding can extend the container slightly; a 300-second truncation must still fail.
  for (const prepared of [proxy, speech]) {
    const { duration } = await probeMedia(prepared, signal);
    expect(duration).toBeGreaterThanOrEqual(301);
    expect(duration).toBeLessThanOrEqual(301.1);
  }
});
