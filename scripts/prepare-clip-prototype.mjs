// Offline media preparation for the recording prototype; never invoked by the app.
import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const data = JSON.parse(await readFile(new URL('../components/prototype/clip-picks.json', import.meta.url), 'utf8'));
const directory = new URL('../public/prototype/', import.meta.url).pathname;
await mkdir(directory, { recursive: true });
function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Prototype media preparation failed.');
}
if (!data.picks.length) throw new Error('Save real development highlight picks before preparing media.');
for (const [i, pick] of data.picks.entries()) {
  if (!(pick.start >= 0 && pick.end <= data.duration && pick.end - pick.start >= 15 && pick.end - pick.start <= 60)) throw new Error('Each highlight must cover 15–60 seconds within the source.');
  // Keep the native frame: the real editor's two-row layout performs the framing.
  ffmpeg(['-ss', String(pick.start), '-i', join(directory, 'tenz-source.mp4'), '-t', String(pick.end - pick.start), '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'libx264', '-preset', 'fast', '-threads', '4', '-r', '30', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', join(directory, `clip-${i + 1}.mp4`)]);
  ffmpeg(['-ss', '1', '-i', join(directory, `clip-${i + 1}.mp4`), '-frames:v', '1', join(directory, `clip-${i + 1}.jpg`)]);
}
ffmpeg(['-ss', '10', '-i', join(directory, 'tenz-source.mp4'), '-frames:v', '1', join(directory, 'source.jpg')]);
