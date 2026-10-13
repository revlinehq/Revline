import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition';
import { REMOTION_TEXT_PRESETS } from '../lib/editor/remotion-text';
import type { Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-remotion-render-'));
  const server = createServer(async (req, res) => {
    const name = req.url?.split('?')[0].slice(1) || 'index.html';
    if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
    if (!['index.html', 'remotion-text.js', 'visual-effects.js', 'gsap.min.js', 'space-grotesk-latin.woff2'].includes(name)) { res.writeHead(404).end(); return; }
    try {
      res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.woff2') ? 'font/woff2' : 'text/html');
      res.end(await readFile(join(directory, name)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    for (const name of ['remotion-text.js', 'visual-effects.js', 'gsap.min.js']) await copyFile(`public/vendor/${name}`, join(directory, name));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory, 'space-grotesk-latin.woff2'));
    const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', clips: REMOTION_TEXT_PRESETS.map((preset, index) => ({
      id: preset, kind: 'graphic', start: 0, duration: 1, sourceStart: 0, text: 'Make your next idea', fontSize: 54,
      x: index % 2 === 0 ? .25 : .75, y: index < 2 ? .3 : .7,
      textTemplate: { preset, duration: 1, offset: 0 },
    })) };
    await writeFile(join(directory, 'index.html'), generateComposition(timeline, [], { resolution: 720, gsapUrl: './gsap.min.js', visualEffectsUrl: './visual-effects.js', remotionTextUrl: './remotion-text.js', fontUrl: './space-grotesk-latin.woff2' }));
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${(server.address() as { port: number }).port}/`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts.ready);
    const frames = new Map<number, Buffer>();
    for (const time of [.25, .75]) {
      await page.evaluate(time => { (window as any).__timelines.revline.seek(time, false); }, time);
      assert.deepEqual(await page.$$eval('[data-remotion-text]', nodes => nodes.map(node => node.getAttribute('data-frame'))), Array(4).fill(String(Math.floor(time * 24))));
      const first = Buffer.from(await page.screenshot());
      await writeFile(`/tmp/revline-remotion-preview-${time}.png`, first);
      await page.evaluate(time => { const clock = (window as any).__timelines.revline; clock.seek(.9, false); clock.seek(0, false); clock.seek(time, false); }, time);
      assert.deepEqual(Buffer.from(await page.screenshot()), first, 'The integrated composition clock must render identical text after backward seeking');
      frames.set(time, execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: first, maxBuffer: 4 * 1024 * 1024 }));
    }
    assert.notDeepEqual(frames.get(.25), frames.get(.75), 'Template motion must advance with the composition clock');
    assert.deepEqual(errors, []);
    const output = join(directory, 'output.mp4');
    const result = await runRenderWorker(directory, output, { fps: 24, quality: 'high' }, () => {}, AbortSignal.timeout(90_000));
    assert.equal(result.warnings, 0);
    const errorsByFrame: string[] = [];
    for (const [time, preview] of frames) {
      const exported = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 4 * 1024 * 1024 });
      execFileSync('ffmpeg', ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-y', `/tmp/revline-remotion-export-${time}.png`]);
      assert.equal(exported.length, preview.length);
      let difference = 0, painted = 0;
      const templateErrors = [0, 0, 0, 0];
      for (let i = 0; i < preview.length; i++) {
        difference += Math.abs(preview[i] - exported[i]);
        if (exported[i] > 80) painted++;
        const pixel = Math.floor(i / 3), quadrant = (pixel % 1280 < 640 ? 0 : 1) + (pixel < 1280 * 360 ? 0 : 2);
        // H.264 YUV rounding shifts the flat background; compare text signal separately.
        templateErrors[quadrant] += Math.abs(Math.max(0, preview[i] - preview[i % 3]) - Math.max(0, exported[i] - exported[i % 3]));
      }
      const error = difference / preview.length;
      assert.ok(error < 3, `Preview/export text pixels diverged at ${time}s: mean error ${error.toFixed(3)}`);
      for (const [index, difference] of templateErrors.entries()) assert.ok(difference / (640 * 360 * 3) < .4, `${REMOTION_TEXT_PRESETS[index]} export differs from the requested frame`);
      assert.ok(painted > 2000, 'Export must paint the template text');
      errorsByFrame.push(`${time}s: ${error.toFixed(3)}`);
    }
    console.log(`PASS: all four genuine Remotion templates advance on the integrated composition clock, seek deterministically and render in MP4; preview/export mean RGB error ${errorsByFrame.join(', ')}.`);
  } finally { await browser.close(); server.close(); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
