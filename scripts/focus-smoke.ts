import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRenderWorker } from '../lib/server/render-worker';
import { generateComposition } from '../lib/editor/composition';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-focus-test-'));
  try {
    const source = join(directory, 'source.png');
    const output = join(directory, 'focus.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=640x1080:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=green:s=640x1080:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=640x1080:r=24:d=1', '-filter_complex', '[0:v][1:v][2:v]hstack=inputs=3[v]', '-map', '[v]', '-frames:v', '1', '-y', source]);
    await copyFile(join(process.cwd(), 'public/vendor/gsap.min.js'), join(directory, 'gsap.min.js'));
    await copyFile(join(process.cwd(), 'public/vendor/visual-effects.js'), join(directory, 'visual-effects.js'));
    await copyFile(join(process.cwd(), 'public/fonts/space-grotesk-latin.woff2'), join(directory, 'space-grotesk-latin.woff2'));
    const html = generateComposition({ fps: 24, aspectRatio: 'vertical', clips: [{ id: 'focus', kind: 'image', assetId: 'source', start: 0, sourceStart: 1, duration: 1, focus: [{ time: 0, x: 0, y: 0.5 }, { time: 1.2, x: 0, y: 0.5 }, { time: 1.8, x: 1, y: 0.5 }, { time: 2, x: 1, y: 0.5 }] }] }, [{ _id: 'source', kind: 'image', fileName: 'source.png', width: 1920, height: 1080, url: './source.png' }], { resolution: 720, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' });
    await writeFile(join(directory, 'index.html'), html);
    const result = await runRenderWorker(directory, output, {fps:24,quality:'draft'}, () => {}, AbortSignal.timeout(60000));
    assert.equal(result.warnings, 0);
    for (const [time, color] of [[0.1, 'red'], [0.5, 'green'], [0.9, 'blue']] as const) {
      const pixel = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output, '-vf', 'crop=2:2:360:640,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const channel = color === 'red' ? 0 : color === 'green' ? 1 : 2;
      assert.ok(pixel[channel] > (color === 'green' ? 80 : 180) && pixel[(channel + 1) % 3] < 50 && pixel[(channel + 2) % 3] < 50, `${time}s crop expected ${color}, got ${[...pixel]}`);
    }
    console.log('Focus render integration passed: source-relative trim, red -> green -> blue subject crop, portrait cover geometry, deterministic GSAP movement, zero warnings.');
  } finally { await rm(directory, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
