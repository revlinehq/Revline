import { afterAll, beforeAll, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectShots } from './detect-shots';
import { probeMedia } from './io';

const run = promisify(execFile);
const installed = existsSync(process.env.SCENE_DETECT_PYTHON || join(process.cwd(), '.data/scene-detection/bin/python'));
let directory: string;
beforeAll(async () => { directory = await mkdtemp(join(tmpdir(), 'revline-shot-test-')); });
afterAll(async () => { await rm(directory, { force: true, recursive: true }); });
test.skipIf(!installed)('detects known cuts at the exact source frames, including a short four-frame shot', async () => {
  const source = join(directory, 'cuts.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=360x360:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=green:s=360x360:r=24:d=0.1666666667', '-f', 'lavfi', '-i', 'color=c=blue:s=360x360:r=24:d=1', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=nb_frames,duration', '-of', 'json', source]);
  const metadata = JSON.parse(stdout).streams[0];
  const result = await detectShots(source, Number(metadata.duration), AbortSignal.timeout(5000));
  expect(result.fps).toBe(24);
  expect(result.shots.map(shot => shot.startFrame)).toEqual([0, 24, 28]);
  expect(result.shots.at(-1)?.endFrame).toBe(Number(metadata.nb_frames));
});
test.skipIf(!installed)('returns one full shot when there are no cuts', async () => {
  const source = join(directory, 'one-shot.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=360x360:r=30:d=1', '-c:v', 'libx264', '-y', source]);
  const result = await detectShots(source, 1, AbortSignal.timeout(5000));
  expect(result).toMatchObject({ fps: 30, sourceTiming: { basis: 'pts', videoStart: 0, frameCount: 30 } });
  expect(result.shots[0]).toMatchObject({ start: 0, startFrame: 0, endFrame: 30 });
  expect(result.shots[0].end).toBeCloseTo(1, 5);
});
test.skipIf(!installed)('detects the complete video even when the container has a longer audio tail', async () => {
  const source = join(directory, 'audio-tail.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=360x360:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=360x360:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-map', '2:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-y', source]);
  const media = await probeMedia(source, AbortSignal.timeout(5000));
  expect(media.duration).toBe(3);
  const result = await detectShots(source, media.duration, AbortSignal.timeout(5000));
  expect(result.shots.map(shot => shot.startFrame)).toEqual([0, 30]);
  expect(result.shots.at(-1)?.endFrame).toBe(60);
  expect(result.shots.at(-1)?.end).toBeCloseTo(2, 5);
});
test.skipIf(!installed)('VFR cut boundaries use decoded indices and actual presentation times', async () => {
  const source = join(directory, 'vfr.mp4');
  await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=360x360:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=360x360:r=30:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,setpts=if(lt(N\\,30)\\,N/(30*TB)\\,(1+(N-30)/15)/TB)[v]', '-map', '[v]', '-fps_mode', 'vfr', '-c:v', 'libx264', '-y', source]);
  const media = await probeMedia(source, AbortSignal.timeout(5000));
  const result = await detectShots(source, media.duration, AbortSignal.timeout(5000));
  expect(result.shots.map(shot => shot.startFrame)).toEqual([0, 30]);
  expect(result.shots[1].start).toBe(1);
  expect(result.shots[1].endFrame).toBe(60);
  // Presentation timestamps can outlast the container's rounded/nominal duration.
  expect(result.sourceTiming?.videoEnd).toBeCloseTo(2.966666, 5);
});
