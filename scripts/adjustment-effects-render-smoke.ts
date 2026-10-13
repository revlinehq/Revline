import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateComposition } from '../lib/editor/composition';
import { motionPreset, NEUTRAL_MOTION } from '../lib/editor/clip-effects';
import type { Clip, Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-adjustments-'));
  try {
    for (const [name, color] of [['matte', '#404040'], ['badge', '#00ff00']]) {
      await writeFile(join(directory, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${color}"/></svg>`);
    }
    await copyFile(join(process.cwd(), 'public/vendor/gsap.min.js'), join(directory, 'gsap.min.js'));
    await copyFile(join(process.cwd(), 'public/vendor/visual-effects.js'), join(directory, 'visual-effects.js'));
    await copyFile(join(process.cwd(), 'public/fonts/space-grotesk-latin.woff2'), join(directory, 'space-grotesk-latin.woff2'));
    const bars: Clip = { id: 'bars', kind: 'effect', track: 2, sourceStart: 0, start: 2, duration: 1 };
    const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', clips: [
      { id: 'base', kind: 'image', assetId: 'matte', track: 1, sourceStart: 0, start: 0, duration: 4 },
      { id: 'upper', kind: 'image', assetId: 'badge', track: 3, sourceStart: 0, start: 0, duration: 4, transform: { x: .85, y: .05, scale: .1, rotation: 0, opacity: 1 } },
      { id: 'light', kind: 'effect', track: 2, sourceStart: 0, start: 1, duration: .5, motion: [0, .5].map(time => ({ time, ...NEUTRAL_MOTION, brightness: 2 })) },
      { ...bars, ...motionPreset(bars, 'cinematic-bars') },
    ] };
    const html = generateComposition(timeline, ['matte', 'badge'].map(id => ({ _id: id, fileName: `${id}.svg`, kind: 'image' as const, url: `./${id}.svg`, width: 1280, height: 720 })), { resolution: 720, fps: 24, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' });
    await writeFile(join(directory, 'index.html'), html);
    const output = join(directory, 'output.mp4');
    const result = await runRenderWorker(directory, output, { fps: 24, quality: 'draft' }, () => {}, AbortSignal.timeout(90_000));
    assert.equal(result.warnings, 0);
    const pixel = (time: number, x: number, y: number) => [...execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output, '-vf', `crop=2:2:${x}:${y},scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
    const near = (values: number[], target: number, label: string) => assert.ok(values.length === 3 && values.every(value => Math.abs(value - target) < 12), `${label}: ${values}`);
    for (const time of [0, .5, 1.75, 3.25]) near(pixel(time, 20, 360), 64, `Neutral outside effect at ${time}`);
    near(pixel(1.25, 20, 360), 128, 'Brightness affects lower layer inside its range');
    near(pixel(2.5, 20, 10), 0, 'Top cinematic bar is visible');
    near(pixel(2.5, 20, 710), 0, 'Bottom cinematic bar is visible');
    near(pixel(2.5, 20, 360), 64, 'Cinematic bars preserve central footage');
    near(pixel(3.25, 20, 10), 64, 'Cinematic bars retract after their range');
    for (const time of [.5, 1.25, 2.5, 3.25]) {
      const [r, g, b] = pixel(time, 1088, 36);
      assert.ok(g > 220 && r < 20 && b < 20, `Upper track stays above effects at ${time}: ${r},${g},${b}`);
    }
    console.log('PASS: real MP4 has timed lower-track brightness, smooth cinematic bars, unaffected upper track, and neutral footage before/after effects.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
