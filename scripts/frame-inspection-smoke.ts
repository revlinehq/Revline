import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extractInspectionFrames } from '../lib/server/inspect-video-frames';
import { inspectVideoFrames } from '../lib/media-analysis/gemini';

const run = promisify(execFile);
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-frame-smoke-'));
  try {
    const source = join(directory, 'source.mp4');
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    const question = 'Which frame first shows the full-screen color changing from red to blue?';
    const broad = await extractInspectionFrames(source, directory, { start: 0, end: 2, question }, 2, AbortSignal.timeout(60_000));
    assert.equal(broad.images.length, 12); assert.equal(broad.sourceFps, 30);
    assert.equal(broad.images[0].frameIndex, 0); assert.equal(broad.images[11].frameIndex, 59);
    const input = { start: .9, end: 1.1, question };
    const narrow = await extractInspectionFrames(source, directory, input, 2, AbortSignal.timeout(60_000));
    assert.deepEqual(narrow.images.map(frame => frame.frameIndex), [27, 28, 29, 30, 31, 32]);
    assert.deepEqual(narrow.images.map(frame => frame.time), [.9, .933333, .966667, 1, 1.033333, 1.066667]);
    console.log('PASS: FFmpeg selected exact source frames and timestamps; broad scan 12 samples, narrow scan 6 consecutive frames.');
    const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!key) { console.log('SKIP: live Gemini inspection; key is not configured.'); return; }
    const evidence = await inspectVideoFrames(narrow.images, narrow.sourceFps, input, key, AbortSignal.timeout(90_000));
    assert.equal(evidence.consecutive, true);
    assert.ok(evidence.frames.find(frame => frame.frameIndex === 29)?.observation.toLowerCase().includes('red'));
    assert.ok(evidence.frames.find(frame => frame.frameIndex === 30)?.observation.toLowerCase().includes('blue'));
    assert.ok(evidence.events.some(event => event.frameIndex === 30 && event.time === 1));
    console.log(JSON.stringify({ verified: true, provider: 'Gemini', firstBlueFrame: 30, sourceTime: 1, sourceFps: evidence.sourceFps, consecutive: evidence.consecutive, sampleInterval: evidence.sampleInterval, summary: evidence.summary, uncertainty: evidence.uncertainty }));
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Frame inspection smoke failed'); process.exitCode = 1; });
