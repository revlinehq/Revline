import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, copyFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { generateComposition } from '../lib/editor/composition';
import type { MediaAsset, Timeline } from '../lib/editor/types';
import { plainExportPlan } from '../lib/editor/plain-export';
import { TEXT_FONTS } from '../lib/editor/text-fonts';
import { runRenderWorker } from '../lib/server/render-worker';
import { renderPlainExport } from '../lib/server/plain-export-render';
import { writeComposition } from '../lib/server/prepare-composition';

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
    await copyFile(join(process.cwd(), 'public/vendor/visual-effects.js'), join(directory, 'visual-effects.js'));
    await copyFile(join(process.cwd(), 'public/vendor/remotion-text.js'), join(directory, 'remotion-text.js'));
    await copyFile(join(process.cwd(), 'public/fonts/space-grotesk-latin.woff2'), join(directory, 'space-grotesk-latin.woff2'));
    const timeline: Timeline = { fps: 24, aspectRatio: 'vertical', clips: [
      { id: 'cut', kind: 'video', assetId: 'source', start: 0, duration: 1, sourceStart: 1, volume: 0 },
      { id: 'audio', kind: 'audio', assetId: 'tone', start: 0, duration: 1, sourceStart: 1, volume: 0.5 },
      { id: 'caption', kind: 'caption', start: 0, duration: 1, sourceStart: 0, text: 'Real captions', fontSize: 96, color: '#FFFFFF', x: 0.5, y: 0.82, animation: 'fade' },
      { id: 'graphic', kind: 'graphic', start: 0, duration: 1, sourceStart: 0, text: 'REVLINE', fontSize: 150, color: '#D4FA73', x: 0.5, y: 0.2, animation: 'rise' },
    ] };
    // The generator supports production 720/1080 presets. Keep this real smoke render small via authored root dimensions.
    const html = generateComposition(timeline, [
      { _id: 'source', fileName: 'source.mp4', kind: 'video', url: './source.mp4' },
      { _id: 'tone', fileName: 'tone.wav', kind: 'audio', url: './tone.wav' },
    ], { resolution, fps, visualEffectsUrl: './visual-effects.js', remotionTextUrl: './remotion-text.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' });
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
    const cancelled = new AbortController();
    const cancellationStarted = Date.now();
    await assert.rejects(runRenderWorker(directory, join(directory, 'cancelled.mp4'), { fps, quality }, value => { if (value.progress > 0) cancelled.abort(); }, cancelled.signal), /cancelled/);
    assert.equal(cancelled.signal.aborted, true);
    assert.ok(Date.now() - cancellationStarted < 15_000, 'Cancelling the render left its worker running.');
    assert.equal(globalThis.Response, originalResponse);
    console.log(`HyperFrames integration passed: isolated worker preserves HTTP globals, live progress and cancellation, first frame, source trimming, mixed audio, animated captions/graphics, ${resolution}p ${fps}fps ${quality} H.264 MP4, 1 second, zero warnings. Render ${(elapsed / 1000).toFixed(2)}s, ${(await stat(output)).size} bytes.`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function probeOutput(path: string) {
  const value = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,color_space,nb_read_packets,sample_rate,channels:format=duration', '-of', 'json', path], { encoding: 'utf8' }));
  const video = value.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video'), audio = value.streams.find((stream: { codec_type: string }) => stream.codec_type === 'audio');
  return { duration: Number(value.format.duration), video, audio };
}
function monoPcm(path: string) {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '48000', '-'], { maxBuffer: 256 * 1024 * 1024 });
  return Int16Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2));
}
/** Level of `a` relative to reference `b` over [from, to) samples, their correlation and residual. */
function compareSound(a: Int16Array, b: Int16Array, from = 0, to = Math.min(a.length, b.length)) {
  let energyA = 0, energyB = 0, product = 0, difference = 0;
  for (let index = from; index < to; index++) { energyA += a[index] ** 2; energyB += b[index] ** 2; product += a[index] * b[index]; difference += (a[index] - b[index]) ** 2; }
  // Silence on either side would make every ratio NaN and pass the range checks unnoticed.
  assert.ok(energyA > 0 && energyB > 0, 'A compared sound section is silent.');
  return { levelDb: 10 * Math.log10(energyA / energyB), correlation: product / Math.sqrt(energyA * energyB), residualDb: 10 * Math.log10(difference / energyB) };
}

/** Render one plain timeline through HyperFrames and the FFmpeg-only path and compare the files. */
async function plainExportParity() {
  const long = process.env.REVLINE_SMOKE_PLAIN_LONG === '1';
  const directory = await mkdtemp(join(tmpdir(), 'revline-plain-export-'));
  try {
    const seconds = long ? 40 : 6;
    // Moving test patterns with embedded sound: 16:9 HD (BT.709 by Chromium's guess) and 4:3 SD at 24 fps (BT.601).
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=1920x1080:r=30:d=${seconds}`, '-f', 'lavfi', '-i', `aevalsrc=0.2*sin(2*PI*(300+60*t)*t)|0.2*sin(2*PI*(450+30*t)*t):s=48000:d=${seconds}`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', join(directory, 'wide.mp4')]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', long ? `testsrc2=s=1920x1080:r=30:d=${seconds}` : `mandelbrot=s=640x480:r=24,trim=duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=44100:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', join(directory, 'second.mp4')]);
    // Non-periodic sweeps expose any audio offset; the voice is mono 44.1 kHz like many recordings.
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=0.3*sin(2*PI*(220+40*t)*t)|0.3*sin(2*PI*(330+25*t)*t):s=48000:d=${seconds}`, '-c:a', 'pcm_s16le', '-y', join(directory, 'music.wav')]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*(500+150*t)*t):s=44100:d=${seconds}`, '-c:a', 'pcm_s16le', '-y', join(directory, 'voice.wav')]);
    for (const name of ['gsap.min.js', 'visual-effects.js']) await copyFile(join(process.cwd(), 'public/vendor', name), join(directory, name));
    for (const font of TEXT_FONTS) await copyFile(join(process.cwd(), 'public/fonts', font.fileName), join(directory, font.fileName));
    const assets: MediaAsset[] = [
      { _id: 'wide', fileName: 'wide.mp4', kind: 'video', url: null, width: 1920, height: 1080 },
      { _id: 'second', fileName: 'second.mp4', kind: 'video', url: null, width: long ? 1920 : 640, height: long ? 1080 : 480 },
      { _id: 'music', fileName: 'music.wav', kind: 'audio', url: null },
      { _id: 'voice', fileName: 'voice.wav', kind: 'audio', url: null },
      { _id: 'wide-sound', fileName: 'wide.mp4', kind: 'audio', url: null },
    ];
    const assetUrls = { wide: './wide.mp4', second: './second.mp4', music: './music.wav', voice: './voice.wav', 'wide-sound': './wide.mp4' };
    // The parity timeline carries its sound on separate audio clips, as linked audio does; embedded
    // video sound is checked against that path below and in embeddedVideoSoundOnce.
    // Long: the measured production shape, two plain 38 s clips at 1080p30. Short: cover and contain
    // framing, an SD source, a black gap, 1.5x and 0.5x speed, gain and a faded music bed.
    const timeline: Timeline = long ? { fps: 30, aspectRatio: 'landscape', clips: [
      { id: 'first', kind: 'video', assetId: 'wide', start: 0, duration: 38, sourceStart: 1, volume: 0 },
      { id: 'second', kind: 'video', assetId: 'second', start: 38, duration: 38, sourceStart: .5, volume: 0 },
      { id: 'first-sound', kind: 'audio', assetId: 'wide-sound', start: 0, duration: 38, sourceStart: 1 },
      { id: 'second-sound', kind: 'audio', assetId: 'music', start: 38, duration: 38, sourceStart: .5 },
    ] } : { fps: 30, aspectRatio: 'vertical', clips: [
      { id: 'cover', kind: 'video', assetId: 'wide', start: 0, duration: 1.5, sourceStart: .5, volume: 0 },
      { id: 'contain', kind: 'video', assetId: 'second', start: 1.5, duration: 1, sourceStart: 1, fit: 'contain', playbackRate: 1.5, volume: 0 },
      { id: 'slow', kind: 'video', assetId: 'wide', start: 3, duration: 1, sourceStart: 3, playbackRate: .5, volume: 0 },
      { id: 'quick', kind: 'video', assetId: 'wide', start: 4, duration: .9, sourceStart: 2, volume: 0 },
      { id: 'voice', kind: 'audio', assetId: 'voice', start: 1.5, duration: 1, sourceStart: 1, playbackRate: 1.5, volume: .8 },
      { id: 'quick-sound', kind: 'audio', assetId: 'wide-sound', start: 4, duration: .9, sourceStart: 2, volume: 1.4 },
      { id: 'music', kind: 'audio', assetId: 'music', start: .25, duration: 4.5, sourceStart: 1, volume: .5, audio: { role: 'music', fadeIn: .5, fadeOut: 1, ducking: { enabled: false, amount: .65, attack: .12, release: .25 } } },
    ] };
    const fps = 30, resolution = 1080, quality = 'standard';
    const decision = plainExportPlan(timeline, assets, resolution, fps);
    assert.ok(decision.eligible, decision.eligible ? '' : decision.reason);
    assert.equal(plainExportPlan({ ...timeline, clips: [...timeline.clips, { id: 'title', kind: 'caption', start: 0, duration: 1, sourceStart: 0, text: 'Title' }] }, assets, resolution, fps).eligible, false);
    await writeComposition(directory, timeline, assets, assetUrls, resolution, fps);
    const browser = join(directory, 'browser.mp4'), fast = join(directory, 'fast.mp4');
    let started = Date.now();
    await runRenderWorker(directory, browser, { fps, quality }, () => {}, AbortSignal.timeout(long ? 1_800_000 : 120_000));
    const browserSeconds = (Date.now() - started) / 1000;
    const progress: number[] = [];
    started = Date.now();
    await renderPlainExport(directory, fast, decision.plan, assetUrls, {}, quality, value => progress.push(value.progress), AbortSignal.timeout(long ? 600_000 : 60_000));
    const fastSeconds = (Date.now() - started) / 1000;
    assert.ok(progress.some(value => value > 0 && value < 100), 'The fast path did not report live progress.');
    const reference = probeOutput(browser), candidate = probeOutput(fast);
    for (const key of ['codec_name', 'width', 'height', 'avg_frame_rate', 'pix_fmt', 'nb_read_packets'] as const) assert.equal(candidate.video[key], reference.video[key], `video ${key}`);
    assert.ok(Math.abs(candidate.duration - reference.duration) < 1.5 / fps, `duration ${candidate.duration} vs ${reference.duration}`);
    assert.equal(candidate.audio?.codec_name, reference.audio?.codec_name);
    assert.equal(candidate.audio?.sample_rate, reference.audio?.sample_rate);
    assert.equal(candidate.audio?.channels, reference.audio?.channels);
    const stats = join(directory, 'ssim.log');
    execFileSync('ffmpeg', ['-v', 'error', '-i', fast, '-i', browser, '-lavfi', `[0:v][1:v]ssim=stats_file=${stats}`, '-f', 'null', '-']);
    const frames = (await readFile(stats, 'utf8')).trim().split('\n').map(line => Number(/All:([\d.]+)/.exec(line)?.[1]));
    const meanSsim = frames.reduce((sum, value) => sum + value, 0) / frames.length, minSsim = Math.min(...frames);
    const { levelDb, correlation, residualDb } = compareSound(monoPcm(fast), monoPcm(browser));
    console.log(`Plain export parity (${long ? '76 s two-clip' : 'multi-clip'} ${reference.video.width}x${reference.video.height} ${reference.video.avg_frame_rate} ${quality}): ${candidate.video.nb_read_packets} frames, duration ${candidate.duration.toFixed(3)}s vs ${reference.duration.toFixed(3)}s, SSIM mean ${meanSsim.toFixed(4)} min ${minSsim.toFixed(4)}, audio level ${levelDb.toFixed(2)} dB, correlation ${correlation.toFixed(4)}, residual ${residualDb.toFixed(1)} dB. Browser ${browserSeconds.toFixed(1)}s, FFmpeg ${fastSeconds.toFixed(1)}s.`);
    // A frame sampled one tick early or late drops a moving test pattern below 0.85.
    assert.ok(meanSsim > .98 && minSsim > .95, 'The FFmpeg export does not match the browser frames.');
    const cancelled = new AbortController(), cancellationStarted = Date.now();
    await assert.rejects(renderPlainExport(directory, join(directory, 'cancelled.mp4'), decision.plan, assetUrls, {}, quality, value => { if (value.progress > 0) cancelled.abort(); }, cancelled.signal), /cancelled/);
    assert.ok(Date.now() - cancellationStarted < 15_000, 'Cancelling the FFmpeg export left it running.');
    assert.ok(Math.abs(levelDb) < .5 && correlation > .98, 'The FFmpeg export audio does not match the browser mix.');
    if (!long) {
      // Embedded video sound takes the producer's video extraction path; it must equal the same
      // source read as a separate audio clip, including speed and gain.
      const embedded = { ...timeline, clips: timeline.clips.filter(clip => clip.kind === 'video').map(clip => clip.id === 'contain' ? { ...clip, assetId: 'wide', volume: .8 } : clip.id === 'quick' ? { ...clip, volume: 1.4 } : clip) };
      const separate = { ...timeline, clips: [...timeline.clips.filter(clip => clip.kind === 'video').map(clip => clip.id === 'contain' ? { ...clip, assetId: 'wide' } : clip), { id: 'contain-sound', kind: 'audio' as const, assetId: 'wide-sound', start: 1.5, duration: 1, sourceStart: 1, playbackRate: 1.5, volume: .8 }, { id: 'quick-sound', kind: 'audio' as const, assetId: 'wide-sound', start: 4, duration: .9, sourceStart: 2, volume: 1.4 }] };
      const outputs = [join(directory, 'embedded.mp4'), join(directory, 'separate.mp4')];
      for (const [index, variant] of [embedded, separate].entries()) {
        const plan = plainExportPlan(variant, assets, resolution, fps);
        assert.ok(plan.eligible);
        await renderPlainExport(directory, outputs[index], plan.plan, assetUrls, {}, 'draft', () => {}, AbortSignal.timeout(60_000));
      }
      const first = monoPcm(outputs[0]), second = monoPcm(outputs[1]);
      let same = 0, energy = 0;
      for (let index = 0; index < Math.min(first.length, second.length); index++) { same += (first[index] - second[index]) ** 2; energy += second[index] ** 2; }
      assert.ok(energy > 0 && same / energy < 1e-4, 'Embedded video sound differs from the same source as an audio clip.');
    }
  } finally {
    if (process.env.REVLINE_SMOKE_KEEP === '1') console.log('Kept', directory); else await rm(directory, { recursive: true, force: true });
  }
}

/** A composited export mixes each clip's embedded video sound once, with that clip's own gain and speed. */
async function embeddedVideoSoundOnce() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-embedded-sound-'));
  try {
    // Non-periodic sweeps, so a second copy from another source offset or speed cannot hide.
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*(300+60*t)*t)|0.2*sin(2*PI*(450+30*t)*t):s=48000:d=6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', join(directory, 'wide.mp4')]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'aevalsrc=0.25*sin(2*PI*(500+150*t)*t):s=44100:d=6', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', join(directory, 'second.mp4')]);
    for (const name of ['gsap.min.js', 'visual-effects.js', 'remotion-runtime.js']) await copyFile(join(process.cwd(), 'public/vendor', name), join(directory, name));
    for (const font of TEXT_FONTS) await copyFile(join(process.cwd(), 'public/fonts', font.fileName), join(directory, font.fileName));
    const assets: MediaAsset[] = [
      { _id: 'wide', fileName: 'wide.mp4', kind: 'video', url: null, width: 1280, height: 720 },
      { _id: 'second', fileName: 'second.mp4', kind: 'video', url: null, width: 1280, height: 720 },
    ];
    const assetUrls = { wide: './wide.mp4', second: './second.mp4' };
    // Three clips of one source (one sped up) and the first clip of another, all with their own gain.
    const footage: Timeline['clips'] = [
      { id: 'first', kind: 'video', assetId: 'wide', start: 0, duration: 1.5, sourceStart: .5 },
      { id: 'quick', kind: 'video', assetId: 'wide', start: 1.5, duration: 1, sourceStart: 2, playbackRate: 1.5, volume: .6 },
      { id: 'other', kind: 'video', assetId: 'second', start: 2.5, duration: 1, sourceStart: 1, volume: 1.3 },
      { id: 'again', kind: 'video', assetId: 'wide', start: 3.5, duration: 1, sourceStart: 3.5, volume: .8 },
    ];
    const plain: Timeline = { fps: 30, aspectRatio: 'landscape', clips: footage };
    const composited: Timeline = { ...plain, clips: [...footage, { id: 'title', kind: 'caption', start: 0, duration: 4.5, sourceStart: 0, text: 'Sound check', fontSize: 64, color: '#FFFFFF', x: .5, y: .8 }] };
    const fast = plainExportPlan(plain, assets, 720, 30);
    assert.ok(fast.eligible && !plainExportPlan(composited, assets, 720, 30).eligible);
    const browser = join(directory, 'browser.mp4'), reference = join(directory, 'reference.mp4');
    await writeComposition(directory, composited, assets, assetUrls, 720, 30);
    await runRenderWorker(directory, browser, { fps: 30, quality: 'draft' }, () => {}, AbortSignal.timeout(120_000));
    // The FFmpeg path reproduces the producer's per-track chain, with each clip mixed once.
    await renderPlainExport(directory, reference, fast.plan, assetUrls, {}, 'draft', () => {}, AbortSignal.timeout(60_000));
    const a = monoPcm(browser), b = monoPcm(reference), results: string[] = [], failures: string[] = [];
    for (const clip of footage) {
      // Skip 30 ms at each edge, where AAC frames straddle clip boundaries.
      const from = Math.round((clip.start + .03) * 48000), to = Math.round((clip.start + clip.duration - .03) * 48000);
      const { levelDb, correlation } = compareSound(a, b, from, to);
      results.push(`${clip.id} ${levelDb >= 0 ? '+' : ''}${levelDb.toFixed(2)} dB r=${correlation.toFixed(4)}`);
      if (Math.abs(levelDb) >= .5 || correlation <= .98) failures.push(clip.id);
    }
    assert.deepEqual(failures, [], `Embedded video sound is not mixed once per clip: ${results.join(', ')}.`);
    console.log(`Composited export mixes embedded video sound once per clip: ${results.join(', ')}.`);
  } finally {
    if (process.env.REVLINE_SMOKE_KEEP === '1') console.log('Kept', directory); else await rm(directory, { recursive: true, force: true });
  }
}

(process.env.REVLINE_SMOKE_PLAIN_ONLY === '1' ? plainExportParity() : process.env.REVLINE_SMOKE_SOUND_ONLY === '1' ? embeddedVideoSoundOnce() : main().then(plainExportParity).then(embeddedVideoSoundOnce)).catch(error => { console.error(error); process.exitCode = 1; });
