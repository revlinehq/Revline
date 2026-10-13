import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition';
import { DEFAULT_COLOR_GRADE, DEFAULT_INVERT, DEFAULT_GLITCH, DEFAULT_ZOOM_BLUR } from '../lib/editor/visual-effects';
import type { Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-visual-effects-'));
  const server = createServer(async (req, res) => {
    const name = req.url?.split('?')[0].slice(1) || 'index.html';
    if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
    if (!['index.html','source.mp4','visual-effects.js','gsap.min.js','space-grotesk-latin.woff2'].includes(name)) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.js') ? 'application/javascript' : 'text/html'); const data = await readFile(join(directory, name));
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) { const start=Number(range[1]),end=range[2]?Number(range[2]):data.length-1;res.writeHead(206,{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});res.end(data.subarray(start,end+1)); }
      else {res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',data.length);res.end(data);}  } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] });
  try {
    execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-y',join(directory,'source.mp4')]);
    await copyFile('public/vendor/visual-effects.js', join(directory,'visual-effects.js'));
    await copyFile('public/vendor/gsap.min.js', join(directory,'gsap.min.js'));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory,'space-grotesk-latin.woff2'));
    const settings = { invert: { ...DEFAULT_INVERT, enabled: true }, colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: -.5, saturation: .55, temperature: 40 }, zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true, amount: .45 }, glitch: { ...DEFAULT_GLITCH, enabled: true, intensity: .85, blockSize: 65, rgbSplit: 35 } };
    const renderSettings = settings;
    const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [{ id: 'video', kind: 'video', assetId: 'source', start: 0, sourceStart: 0, duration: 1, track: 1, volume: 0, ...renderSettings }] };
    await writeFile(join(directory,'index.html'), generateComposition(timeline, [{ _id: 'source', kind: 'video', fileName: 'source.mp4', url: './source.mp4', width: 320, height: 180 }], { resolution: 720, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' }));
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('canvas.visual-effect-output', { timeout: 8000 }).catch(async error => { console.error({ errors, state: await page.evaluate(() => ({ runtime: !!(window as any).__revlineEffects, time: (window as any).__timelines?.revline?.time(), videos: [...document.querySelectorAll('video')].map(v => ({ ready: v.readyState, width: v.videoWidth, error: v.error?.message })) })) }); throw error; });
    const readPixels = () => page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.visual-effect-output')!;
      const scaled = document.createElement('canvas'); scaled.width = 32; scaled.height = 18;
      const ctx = scaled.getContext('2d')!; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, 32, 18);
      return Array.from(ctx.getImageData(0, 0, 32, 18).data).filter((_, i) => i % 4 !== 3);
    });
    const update = async (effects: object) => { await page.evaluate(effects => { (window as any).__revlineEffects.set('clip-0', effects); }, effects); };
    const neutral = { colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: .0001 } };
    await update(neutral);
    const baseline = await readPixels();
    const distance = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
    for (const key of ['colorGrade','zoomBlur','glitch','invert'] as const) {
      await update({ [key]: settings[key] });
      assert.ok(distance(baseline, await readPixels()) > 5, `${key} must actually change pixels`);
    }
    await update({ invert: settings.invert });
    const negative = await readPixels();
    assert.ok(distance(negative, baseline.map(value => 255 - value)) < 2, 'Full inversion must produce actual negative RGB colors');
    await update({ invert: { enabled: true, amount: .5 } });
    assert.ok((await readPixels()).every(value => Math.abs(value - 128) <= 1), 'Half inversion mixes each channel to middle gray');
    await update(renderSettings);
    await page.evaluate(async () => {
      const video = document.querySelector('video')!;
      const decoded = new Promise<void>((resolve, reject) => { video.addEventListener('seeked', () => resolve(), { once: true }); setTimeout(() => reject(new Error('Video seek timed out')), 5000); });
      video.currentTime = .5; await decoded;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      (window as any).__timelines.revline.seek(.5, false); (window as any).__revlineEffects.redraw();
    });
    const preview = await readPixels();
    await page.evaluate(() => { (window as any).__timelines.revline.seek(.75, false); (window as any).__timelines.revline.seek(.5, false); (window as any).__revlineEffects.redraw(); });
    assert.deepEqual(await readPixels(), preview, 'Glitch must be deterministic at the same frame');
    await update({});
    assert.equal(await page.$('canvas.visual-effect-output'), null, 'Disabled effects must free their canvas');
    assert.equal(await page.$$eval('video', nodes => nodes.length), 1, 'Effects must not clone video decoders');
    assert.deepEqual(errors.filter(message => !message.includes('favicon')), []);
    const output = join(directory,'output.mp4');
    const result = await runRenderWorker(directory, output, { fps:24,quality:'high' }, () => {}, AbortSignal.timeout(90_000));
    assert.equal(result.warnings, 0);
    const exported = [...execFileSync('ffmpeg', ['-v','error','-ss','0.5','-i',output,'-vf','scale=32:18','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])];
    const error = distance(preview, exported);
    assert.ok(error < 12, `Preview/export pixel mismatch: mean error ${error.toFixed(2)}`);
    assert.ok(distance(baseline, exported) > 5, 'Export must include effects');
    console.log(`PASS: real MP4 color, radial zoom blur, deterministic RGB/block glitch and negative inversion; preview/export mean pixel error ${error.toFixed(2)}, one decoder and disabled canvas cleanup.`);
  } finally { await browser.close(); server.close(); await rm(directory, { recursive:true,force:true }); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
