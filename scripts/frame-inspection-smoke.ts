import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extractInspectionFrames } from '../lib/server/inspect-video-frames';
import { inspectVideoFrames } from '../lib/media-analysis/gemini';
import { frameInspectionCoverage,parseFrameInspection,assertConsecutiveInspection } from '../lib/media-analysis/frame-inspection';

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
    const briefSource=join(directory,'brief-60fps.mp4'),briefRequest={start:0,end:3,question:'Is a brief blue reset visible?'};
    await run('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=60:d=1.45','-f','lavfi','-i','color=c=blue:s=320x180:r=60:d=0.1','-f','lavfi','-i','color=c=red:s=320x180:r=60:d=1.45','-filter_complex_threads','1','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',briefSource]);
    const brief=await extractInspectionFrames(briefSource,directory,briefRequest,3,AbortSignal.timeout(60_000));
    assert.equal(brief.images.some(frame=>frame.frameIndex>=87&&frame.frameIndex<93),false);
    const coverage=frameInspectionCoverage({...briefRequest,sourceFps:brief.sourceFps,frames:brief.images}),refinement=coverage.refinementWindows[0];
    const closeRequest={...briefRequest,start:refinement.start,end:refinement.end},close=await extractInspectionFrames(briefSource,directory,closeRequest,3,AbortSignal.timeout(60_000));
    assert.ok(close.images.some(frame=>frame.frameIndex>=87&&frame.frameIndex<93));
    const closeEvidence=parseFrameInspection(JSON.stringify({summary:'Locally checked sample coverage.',uncertainty:'No model call.',frames:close.images.map(frame=>({frameIndex:frame.frameIndex,observation:'Decoded synthetic frame.'})),events:[]}),closeRequest,close.images,close.sourceFps);
    assertConsecutiveInspection(closeEvidence);
    console.log('PASS: real 60 fps 100 ms event falls between broad samples; suggested bounded refinement decodes consecutive frames containing it.');
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
