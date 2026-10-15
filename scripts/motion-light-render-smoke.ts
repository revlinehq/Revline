import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';
import { generateComposition } from '../lib/editor/composition';
import { DEFAULT_COLOR_GRADE, DEFAULT_DIRECTIONAL_BLUR, DEFAULT_TURBULENT_DISPLACE, DEFAULT_LIGHT_SWEEP, type VisualEffects } from '../lib/editor/visual-effects';
import type { Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

const distance = (a: number[], b: number[]) => a.reduce((total, value, index) => total + Math.abs(value - b[index]), 0) / a.length;
async function capture(page: Page) {
  return page.evaluate(() => {
    const source = document.querySelector<HTMLCanvasElement>('.visual-effect-output')!;
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261; for (const value of data) hash = Math.imul(hash ^ value, 16777619) >>> 0;
    canvas.width = 64; canvas.height = 36; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source, 0, 0, 64, 36);
    return { hash, pixels: Array.from(ctx.getImageData(0, 0, 64, 36).data).filter((_, index) => index % 4 !== 3) };
  });
}
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-motion-light-'));
  const server = createServer(async (req, res) => {
    const name = req.url?.split('?')[0].slice(1) || 'index.html';
    if (!['index.html', 'preview.html', 'source.png', 'transparent.png', 'visual-effects.js', 'gsap.min.js', 'space-grotesk-latin.woff2'].includes(name)) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : name.endsWith('.png') ? 'image/png' : 'text/html'); res.end(await readFile(join(directory, name))); } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
  const errors: string[] = [];
  try {
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-frames:v', '1', '-threads', '1', '-y', join(directory, 'source.png')]);
    for (const name of ['visual-effects.js', 'gsap.min.js']) await copyFile(`public/vendor/${name}`, join(directory, name));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory, 'space-grotesk-latin.woff2'));
    const assets = [{ _id: 'source', kind: 'image' as const, fileName: 'source.png', url: './source.png', width: 640, height: 360 }];
    const settings = { directionalBlur: { ...DEFAULT_DIRECTIONAL_BLUR, enabled: true, amount: 35, angle: 32 }, turbulentDisplace: { ...DEFAULT_TURBULENT_DISPLACE, enabled: true, amount: 70, scale: 180, speed: 1.5 }, lightSweep: { ...DEFAULT_LIGHT_SWEEP, enabled: true, amount: .9, color: '#ffeea8', angle: -35, position: .3, width: .35, speed: .7 } };
    const neutral = { colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: .000001 } };
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
    page.on('pageerror', error => errors.push(String(error)));
    const set = async (effects: VisualEffects) => page.evaluate(effects => (window as any).__revlineEffects.set('clip-0', effects), effects);
    const seek = async (frame: number) => page.evaluate(frame => { (window as any).__timelines.revline.seek(frame / 24, false); (window as any).__revlineEffects.redraw(); }, frame);
    for (const key of ['directionalBlur', 'turbulentDisplace', 'lightSweep'] as const) {
      const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [{ id: 'image', kind: 'image', assetId: 'source', start: 0, sourceStart: 0, duration: 1, track: 1, [key]: settings[key] }] };
      const options = { resolution: 720 as const, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' };
      await writeFile(join(directory, 'index.html'), generateComposition(timeline, assets, options));
      await writeFile(join(directory, 'preview.html'), generateComposition(timeline, assets, { ...options, preview: true }));
      await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.visual-effect-output'); await seek(12);
      await set(neutral); const baseline = await capture(page);
      await set({ ...neutral, [key]: { ...settings[key], enabled: false } }); assert.equal((await capture(page)).hash, baseline.hash, `${key} bypass must be pixel neutral with another effect active`);
      await set({ ...neutral, [key]: { ...settings[key], amount: 0 } }); assert.equal((await capture(page)).hash, baseline.hash, `${key} strength zero must be pixel neutral with another effect active`);
      await set({ [key]: { ...settings[key], enabled: false } }); assert.equal(await page.$('.visual-effect-output'), null, `${key} bypass frees canvas and reveals untouched media`);
      await set({ [key]: { ...settings[key], amount: 0 } }); assert.equal(await page.$('.visual-effect-output'), null, `${key} zero strength frees canvas`);
      await set({ [key]: settings[key] }); const treated = await capture(page);
      assert.ok(distance(baseline.pixels, treated.pixels) > 1, `${key} must produce visible real pixels`);
      await seek(19); const advanced = await capture(page);
      if(key === 'directionalBlur') assert.equal(advanced.hash, treated.hash, 'Directional blur remains static on static media'); else assert.notEqual(advanced.hash, treated.hash, `${key} animates on the timeline clock`);
      await seek(12); assert.equal((await capture(page)).hash, treated.hash, `${key} backward seek restores exact RGBA pixels`);
      if(key !== 'directionalBlur') { await set({ [key]: { ...settings[key], speed: 0 } }); const frozen = await capture(page); await seek(19); assert.equal((await capture(page)).hash, frozen.hash, `${key} speed zero holds the effect`); await seek(12); }
      const patches = key === 'directionalBlur' ? [{angle:90},{amount:3}] : key === 'turbulentDisplace' ? [{amount:15},{scale:30},{speed:3}] : [{color:'#245cff'},{position:.8},{width:.08},{angle:90},{speed:3}];
      for (const patch of patches) { await set({[key]:{...settings[key],...patch}}); assert.notEqual((await capture(page)).hash, treated.hash, `${key} ${Object.keys(patch)[0]} independently controls pixels`); }
      await set({ [key]: settings[key] }); await seek(12);
      await page.screenshot({ path: `/tmp/revline-${key}-effect.png` });
      const live = await browser.newPage(); await live.setViewport({ width: 1280, height: 720 }); await live.goto(`${url}/preview.html`, { waitUntil: 'networkidle0' }); await live.waitForSelector('.visual-effect-output');
      await live.evaluate(() => { (window as any).__timelines.revline.seek(.5, false); (window as any).__revlineEffects.redraw(); });
      const previewError = distance(treated.pixels, (await capture(live)).pixels); assert.ok(previewError < 4, `${key} actual preview/export parity error ${previewError}`); await live.close();
      const output = join('/tmp', `revline-${key}-effect.mp4`);
      const result = await runRenderWorker(directory, output, { fps: 24, quality: 'high' }, () => {}, AbortSignal.timeout(120_000)); assert.equal(result.warnings, 0);
      const encoded = [...execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', output, '-vf', 'scale=64:36', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])];
      const expectedFrame = [...execFileSync('ffmpeg', ['-v', 'error', '-i', `/tmp/revline-${key}-effect.png`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 8 * 1024 * 1024 })];
      const encodedFrame = [...execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 8 * 1024 * 1024 })];
      const error = distance(expectedFrame, encodedFrame); assert.ok(error < 7, `${key} MP4 mean RGB error ${error}`); assert.ok(distance(baseline.pixels, encoded) > 1, `${key} MP4 includes texture`);
      console.log(`PASS ${key}: exact bypass/zero/backward seek, editable pixels, speed-zero hold, preview/export error ${previewError.toFixed(3)}, MP4 error ${error.toFixed(3)}. ${output}`);
    }
    await set(settings); await seek(12); const together = await capture(page);
    await set({ ...settings, frameCorners: { enabled: true, amount: .7 } });
    assert.equal(await page.evaluate(() => { const canvas = document.querySelector<HTMLCanvasElement>('.visual-effect-output')!; const gl = canvas.getContext('webgl')!; const pixel = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return pixel[3]; }), 0, 'Textures retain transparent rounded corners');
    await set(settings); assert.equal((await capture(page)).hash, together.hash, 'Combining the effects remains deterministic');
    // Clear an actual source hole and composite rounded/cropped footage over a green layer.
    const transparent = await page.evaluate(() => { const source = document.querySelector<HTMLImageElement>('img[id="clip-0"]')!; const c = document.createElement('canvas'); c.width = 640; c.height = 360; const ctx = c.getContext('2d')!; ctx.drawImage(source, 0, 0, 640, 360); ctx.clearRect(240, 110, 160, 140); return c.toDataURL('image/png').split(',')[1]; });
    await writeFile(join(directory, 'transparent.png'), Buffer.from(transparent, 'base64'));
    const transparentTimeline: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 0 }, clips: [
      { id: 'green', kind: 'solid', start: 0, sourceStart: 0, duration: 1, track: 1, solidColor: { color: '#12e664', width: 1, height: 1, x: .5, y: .5, opacity: 1 } },
      { id: 'hole', kind: 'image', assetId: 'hole', start: 0, sourceStart: 0, duration: 1, track: 2, crop: { left: .1, right: .05, top: .05, bottom: .1 }, frameCorners: { enabled: true, amount: .7 }, ...settings },
    ] };
    const transparentHtml = generateComposition(transparentTimeline, [{ ...assets[0], _id: 'hole', fileName: 'transparent.png', url: './transparent.png' }], { resolution: 720, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' });
    await writeFile(join(directory, 'index.html'), transparentHtml); await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForSelector('.visual-effect-output'); await seek(12);
    const compositeSamples = async (path: string) => { await page.screenshot({ path }); return [[2, 2], [640, 360], [1277, 717]].map(([x, y]) => [...execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]); };
    const lit = await compositeSamples('/tmp/revline-motion-light-transparent.png');
    await page.evaluate(() => (window as any).__revlineEffects.set('clip-1', { frameCorners: { enabled: true, amount: .7 } }));
    const unlit = await compositeSamples('/tmp/revline-motion-light-transparent-neutral.png');
    assert.deepEqual(lit, unlit, 'The new effects leave actual composited hole/corner pixels unchanged over the underlay');
    for (const rgb of lit) assert.deepEqual(rgb, [18, 230, 100], 'Transparent footage and rounded/cropped corners reveal exact green underlay without emissive RGB');
    const transparentOutput = '/tmp/revline-motion-light-transparent.mp4';
    await runRenderWorker(directory, transparentOutput, { fps: 24, quality: 'high' }, () => {}, AbortSignal.timeout(120_000));
    for (const [x, y] of [[2, 2], [640, 360], [1277, 717]]) { const rgb = [...execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', transparentOutput, '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]; assert.ok(distance(rgb, [18, 230, 100]) < 3, 'Encoded transparent corners/hole retain the underlay color'); }
    console.log('PASS: transparent source hole, cropped/rounded corners composite exactly over the green layer in-browser and retain that layer in actual MP4.');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.close(); await rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
