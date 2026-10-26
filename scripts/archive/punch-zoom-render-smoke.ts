import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { generateComposition } from '../../lib/editor/composition';
import { addEffectClip, patchClip } from '../../lib/editor/operations';
import { configureTimedEffectPatch } from '../../lib/editor/clip-effects';
import { runRenderWorker } from '../../lib/server/render-worker';
import type { Timeline } from '../../lib/editor/types';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-punch-zoom-'));
  const server = createServer(async (request, response) => { const name = request.url?.slice(1) || 'index.html'; if (!['index.html','grid.svg','visual-effects.js','gsap.min.js','space-grotesk-latin.woff2'].includes(name)) { response.writeHead(404).end(); return; } try { response.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html'); response.end(await readFile(join(directory, name))); } catch { response.writeHead(404).end(); } });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] });
  try {
    await writeFile(join(directory, 'grid.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#203048"/><path d="M320 0V720 M640 0V720 M960 0V720 M0 180H1280 M0 360H1280 M0 540H1280" stroke="#4770ed" stroke-width="12"/><circle cx="640" cy="360" r="80" fill="#eeb455"/></svg>');
    for (const name of ['visual-effects.js','gsap.min.js']) await copyFile(`public/vendor/${name}`, join(directory, name));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory, 'space-grotesk-latin.woff2'));
    const base: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0, effects: 0 }, clips: [{ id: 'image', kind: 'image', assetId: 'grid', track: 1, start: 0, sourceStart: 0, duration: 1.2 }] };
    const added = addEffectClip(base, 'punch', 'punch', .2, { duration: .8 });
    const timeline = patchClip(added, 'punch', configureTimedEffectPatch(added.clips.at(-1)!, { punch: { amount: 1.6, attack: .2, release: .3, speed: 1 } }));
    await writeFile(join(directory, 'index.html'), generateComposition(timeline, [{ _id: 'grid', kind: 'image', fileName: 'grid.svg', url: './grid.svg', width: 1280, height: 720 }], { resolution: 720, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' }));
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 }); await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}`, { waitUntil: 'networkidle0' }); await page.waitForSelector('[data-effect-clip="punch"]');
    const captures: { time: number; path: string }[] = [];
    for (const [time, scale] of [[.2,1],[.4,1.6],[.7,1]] as const) {
      await page.evaluate(time => { (window as any).__timelines.revline.seek(time, false); }, time);
      assert.ok(Math.abs(await page.$eval('[data-effect-clip="punch"]', node => new DOMMatrix(getComputedStyle(node).transform).a) - scale) < .0001, `Shared renderer scale at ${time}s matches authored attack/return`);
      const path = `/tmp/revline-punch-${Math.round(time * 30)}.png`; await page.screenshot({ path }); captures.push({ time, path });
    }
    const output = '/tmp/revline-punch-zoom.mp4'; const result = await runRenderWorker(directory, output, { fps: 30, quality: 'high' }, () => {}, AbortSignal.timeout(120_000)); assert.equal(result.warnings, 0);
    let worst = 0;
    for (const capture of captures) {
      const expected = execFileSync('ffmpeg', ['-v','error','-i',capture.path,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 8 * 1024 * 1024 });
      const encoded = execFileSync('ffmpeg', ['-v','error','-ss',String(capture.time),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'], { maxBuffer: 8 * 1024 * 1024 });
      const error = expected.reduce((sum, value, index) => sum + Math.abs(value - encoded[index]), 0) / expected.length; worst = Math.max(worst, error); assert.ok(error < 3, `Punch frame ${capture.time}s MP4 mean RGB error ${error}`);
    }
    console.log(`PASS: actual MP4 includes exact authored Punch attack/strength/return phases; max mean RGB error ${worst.toFixed(3)}/255. ${output}`);
  } finally { await browser.close(); server.close(); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
