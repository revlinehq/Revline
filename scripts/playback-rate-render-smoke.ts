import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateComposition } from '../lib/editor/composition';
import type { Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-playback-rate-'));
  try {
    const source = join(directory, 'source.mp4'), audio = join(directory, 'tone.wav'), output = join(directory, 'output.mp4');
    execFileSync('ffmpeg', ['-v', 'error', ...['red', 'green', 'blue', 'yellow'].flatMap(color => ['-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=24:d=1`]), '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', source]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=4', '-y', audio]);
    for (const name of ['gsap.min.js', 'visual-effects.js']) await copyFile(`public/vendor/${name}`, join(directory, name));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory, 'space-grotesk-latin.woff2'));
    const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', clips: [
      { id: 'fast', kind: 'video', assetId: 'source', start: 0, duration: 1, sourceStart: .5, playbackRate: 2, volume: 0 },
      { id: 'slow', kind: 'video', assetId: 'source', start: 1, duration: 2, sourceStart: 1.5, playbackRate: .5, volume: 0 },
      { id: 'fast-audio', kind: 'audio', assetId: 'tone', start: 0, duration: 1, sourceStart: .5, playbackRate: 2, volume: 1 },
      { id: 'slow-audio', kind: 'audio', assetId: 'tone', start: 1, duration: 2, sourceStart: 1.5, playbackRate: .5, volume: 1 },
    ] };
    await writeFile(join(directory, 'index.html'), generateComposition(timeline, [
      { _id: 'source', kind: 'video', fileName: 'source.mp4', url: './source.mp4', width: 320, height: 180 },
      { _id: 'tone', kind: 'audio', fileName: 'tone.wav', url: './tone.wav' },
    ], { resolution: 720, gsapUrl: './gsap.min.js', visualEffectsUrl: './visual-effects.js', fontUrl: './space-grotesk-latin.woff2' }));
    const result = await runRenderWorker(directory, output, { fps: 24, quality: 'high' }, () => {}, AbortSignal.timeout(90_000));
    assert.equal(result.warnings, 0);
    const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output], { encoding: 'utf8' }));
    assert.ok(Math.abs(duration - 3) < .1, 'Output duration uses timeline seconds');
    for (const [time, channel] of [[.1, 0], [.35, 1], [.85, 2], [1.4, 1], [2.6, 2]]) {
      const pixel = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output, '-vf', 'crop=2:2:640:360,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      assert.ok(pixel[channel] > 90 && pixel[channel] > Math.max(...[...pixel].filter((_, index) => index !== channel)) * 2, `Wrong source frame at ${time}s: RGB ${[...pixel]}`);
    }
    for (const [name, time] of [['faster', .2], ['slower', 1.5]] as const) {
      const pcm = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output, '-t', '0.4', '-map', '0:a:0', '-f', 's16le', '-ac', '1', '-ar', '44100', '-']);
      let crossings = 0, energy = 0;
      for (let i = 2; i < pcm.length; i += 2) { const value = pcm.readInt16LE(i); if (pcm.readInt16LE(i - 2) <= 0 && value > 0) crossings++; energy += value * value; }
      const pitch = crossings / (pcm.length / 2 / 44100);
      assert.ok(Math.sqrt(energy / (pcm.length / 2)) > 500, `${name} audio is audible`);
      assert.ok(Math.abs(pitch - 880) < 15, `${name} audio preserves 880Hz pitch: measured ${pitch.toFixed(1)}Hz`);
    }
    console.log('PASS: actual 2× and 0.5× MP4 renders map trimmed source frames correctly, produce a 3-second timeline, and preserve audible 880Hz pitch in linked audio.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
