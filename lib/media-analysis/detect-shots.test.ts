import { afterAll, beforeAll, expect, test } from 'vitest';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectShots } from './detect-shots';

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
  await expect(detectShots(source, 1, AbortSignal.timeout(5000))).resolves.toEqual({ fps: 30, shots: [{ start: 0, end: 1, startFrame: 0, endFrame: 30 }] });
});
