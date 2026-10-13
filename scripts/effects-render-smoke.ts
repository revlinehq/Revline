import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { motionPreset } from '../lib/editor/clip-effects';
import { generateComposition } from '../lib/editor/composition';
import type { Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const originalRequest = globalThis.Request, originalResponse = globalThis.Response;
  const resolution = process.env.REVLINE_SMOKE_FULL_HD === '1' ? 1080 : 720;
  const fps = resolution === 1080 ? 60 : 24;
  const quality = resolution === 1080 ? 'high' : 'draft';
  const pixelScale = resolution / 720;
  const directory = await mkdtemp(join(tmpdir(), 'revline-render-test-'));
  try {
    const source = join(directory, 'source.mp4');
    const audio = join(directory, 'tone.wav');
    const output = join(directory, 'result.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=180x320:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=24:d=2', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-af', "volume='if(lt(t,1),0,1)':eval=frame", '-y', audio]);
    await copyFile(join(process.cwd(), 'public/vendor/gsap.min.js'), join(directory, 'gsap.min.js'));
    await copyFile(join(process.cwd(), 'public/fonts/space-grotesk-latin.woff2'), join(directory, 'space-grotesk-latin.woff2'));
    const timeline: Timeline = { fps: 24, aspectRatio: 'vertical', clips: [
      { id: 'cut', kind: 'video', assetId: 'source', start: 0, duration: 1, sourceStart: 1, volume: 0 },
      { id: 'audio', kind: 'audio', assetId: 'tone', start: 0, duration: 1, sourceStart: 1, volume: 0.5 },
      { id: 'caption', kind: 'caption', start: 0, duration: 1, sourceStart: 0, text: 'Real captions', fontSize: 96, color: '#FFFFFF', x: 0.5, y: 0.82, animation: 'fade' },
      { id: 'graphic', kind: 'graphic', start: 0, duration: 1, sourceStart: 0, text: 'REVLINE', fontSize: 150, color: '#D4FA73', x: 0.5, y: 0.2, animation: 'rise' },
    ] };
    await writeFile(join(directory, 'overlay.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="red"/></svg>');
    const overlay = { id:'light', kind:'image' as const, assetId:'overlay', track:5, start:0, duration:1, sourceStart:0, blendMode:'screen' as const, transform:{x:.5,y:.5,scale:.5,rotation:0,opacity:1} };
    timeline.clips.push({ ...overlay, ...motionPreset(overlay, 'fade') });
    // The generator supports production 720/1080 presets. Keep this real smoke render small via authored root dimensions.
    const html = generateComposition(timeline, [
      { _id: 'source', fileName: 'source.mp4', kind: 'video', url: './source.mp4' },
      { _id: 'overlay', fileName:'overlay.svg', kind:'image', url:'./overlay.svg', width:180, height:320 },
      { _id: 'tone', fileName: 'tone.wav', kind: 'audio', url: './tone.wav' },
    ], { resolution, fps, gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' });
    await writeFile(join(directory, 'index.html'), html);
    const progress: number[] = [];
    const started = Date.now();
    const result = await runRenderWorker(directory, output, { fps, quality }, value => progress.push(value.progress), AbortSignal.timeout(60_000));
    const elapsed = Date.now() - started;
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,avg_frame_rate', '-show_entries', 'format=duration', '-of', 'json', output], { encoding: 'utf8' }));
    assert.equal(result.warnings, 0);
    assert.equal(globalThis.Request, originalRequest);
    assert.equal(globalThis.Response, originalResponse);
    assert.ok(progress.some(value => value > 0), 'The worker did not report live progress.');
    assert.ok(Math.abs(Number(probe.format.duration) - 1) < 0.1);
    assert.ok(probe.streams.some((stream: { codec_name: string }) => stream.codec_name === 'aac'));
    assert.ok(probe.streams.some((stream: { codec_name: string; width: number; height: number; avg_frame_rate: string }) => stream.codec_name === 'h264' && stream.width === resolution && stream.height === Math.round(resolution * 16 / 9 / 2) * 2 && stream.avg_frame_rate === `${fps}/1`));
    // The second source second is blue: a red first-second frame would expose ignored sourceStart.
    for (const time of ['0', '0.5']) {
      const pixel = execFileSync('ffmpeg', ['-v', 'error', '-ss', time, '-i', output, '-vf', 'crop=2:2:10:640,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      assert.ok(pixel[2] > 180 && pixel[0] < 70, `Source trim or first-frame visibility failed at ${time}s: pixel ${[...pixel]}`);
    }
    const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '44100', '-']);
    let squared = 0;
    for (let offset = 0; offset < pcm.length; offset += 2) squared += pcm.readInt16LE(offset) ** 2;
    assert.ok(Math.sqrt(squared / (pcm.length / 2)) > 500, 'Audio source offset or mixing produced silence.');
    // Confirm overlays painted using high-luma pixels around both text positions.
    for (const [name, y] of [['graphic', 180], ['caption', 970]] as const) {
      const frame = execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', output, '-vf', `crop=${600 * pixelScale}:${180 * pixelScale}:${60 * pixelScale}:${y * pixelScale}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 2 * 1024 * 1024 });
      let bright = 0;
      for (let index = 0; index < frame.length; index += 3) if (frame[index] > 170 && frame[index + 1] > 170) bright++;
      assert.ok(bright > 100, `${name} overlay did not paint.`);
    }
    for (const [time, expectedRed] of [['0', false], ['0.5', true]] as const) {
      const pixel = execFileSync('ffmpeg', ['-v','error','-ss',time,'-i',output,'-vf',`crop=2:2:${360 * pixelScale}:${640 * pixelScale},scale=1:1`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-']);
      assert.ok(pixel[2] > 150 && (expectedRed ? pixel[0] > 150 : pixel[0] < 70), `Screen overlay + fade failed at ${time}: ${[...pixel]}`);
    }
    const cancelled = new AbortController();
    const cancellationStarted = Date.now();
    await assert.rejects(runRenderWorker(directory, join(directory, 'cancelled.mp4'), { fps, quality }, value => { if (value.progress > 0) cancelled.abort(); }, cancelled.signal), /cancelled/);
    assert.equal(cancelled.signal.aborted, true);
    assert.ok(Date.now() - cancellationStarted < 15_000, 'Cancelling the render left its worker running.');
    assert.equal(globalThis.Response, originalResponse);
    console.log(`HyperFrames integration passed: isolated worker preserves HTTP globals, live progress and cancellation, first frame, source trimming, mixed audio, animated captions/graphics, Screen overlay and fade-in pixels, ${resolution}p ${fps}fps ${quality} H.264 MP4, 1 second, zero warnings. Render ${(elapsed / 1000).toFixed(2)}s, ${(await stat(output)).size} bytes.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
