import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackSourceFace } from '../lib/server/track-source-face';
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-worker-tracking-'));
  try {
    const image = await fetch('https://storage.googleapis.com/mediapipe-assets/portrait.jpg'); assert.ok(image.ok);
    const portrait = join(directory, 'portrait.jpg'), video = join(directory, 'moving-face.mp4');
    await writeFile(portrait, Buffer.from(await image.arrayBuffer()));
    execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-i', portrait, '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:r=24:d=4', '-filter_complex', "[0:v]crop=500:500:150:0,scale=220:220[face];[1:v][face]overlay=x='(W-w)*t/4':y=70:shortest=1[v]", '-map', '[v]', '-t', '4', '-r', '24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', video]);
    const focus = await trackSourceFace(video, 4, () => {}, AbortSignal.timeout(90_000));
    assert.ok(focus.length >= 7); assert.equal(focus[0].time, 0);
    assert.ok(focus.at(-1)!.x - focus[0].x > .4, 'Worker must track movement across source frames');
    assert.ok(focus.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
    console.log('Background MediaPipe tracking passed: moving face follows source timestamps and normalized coordinates.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Tracking failed'); process.exitCode = 1; });
