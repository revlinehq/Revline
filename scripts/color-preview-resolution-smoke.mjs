import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

// Generated high-frequency footage, through the real Preview and viewport. No
// backend, account, private media, or running development server is involved.
const directory = await mkdtemp(join(tmpdir(), 'revline-color-resolution-'));
const pixels = Buffer.alloc(1920 * 1080 * 3);
for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
  const value = x % 8 < 4 ? 224 : 32, at = (y * 1920 + x) * 3;
  pixels[at] = pixels[at + 1] = pixels[at + 2] = value;
}
await sharp(pixels, { raw: { width: 1920, height: 1080, channels: 3 } }).png().toFile(join(directory, 'source.png'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', join(directory, 'source.png'), '-t', '3', '-r', '30', '-vf', "drawtext=text='%{n}':x=20:y=1000:fontsize=48:fontcolor=red", '-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'source.mp4')]);
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {Preview} from './components/editor/preview';import {PreviewViewport,PreviewZoomControls,PreviewZoomProvider} from './components/editor/preview-zoom';
import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import './app/editor.css';
const kind=new URLSearchParams(location.search).get('media')==='image'?'image':'video';
const original={id:'source',assetId:'source',kind,track:1,start:0,duration:3,sourceStart:0,fit:'contain'};
const assets=[{_id:'source',kind,fileName:'Generated stripe footage',width:1920,height:1080,url:location.origin+(kind==='video'?'/source.mp4':'/source.png')}];
const base={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[original]},store=createEditorStore(base);window.fixtureErrors=[];
function Fixture(){const [clip,setClip]=useState(original);window.patchClip=patch=>setClip(previous=>({...previous,...patch}));return <EditorStateProvider store={store}><PreviewZoomProvider canvas={{width:1920,height:1080}}><div className="canvas-toolbar"><PreviewZoomControls/></div><div className="stage-center fixture-stage"><PreviewViewport><Preview timeline={{...base,clips:[clip]}} assets={assets} time={0} onTime={()=>{}} onPlaying={()=>{}} onError={error=>window.fixtureErrors.push(error)} muted/></PreviewViewport></div></PreviewZoomProvider></EditorStateProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-color-resolution-bundle', define: { 'process.env.NODE_ENV': '"production"' } });
const runtime = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const files = new Map([
  ['/', '<!doctype html><html data-workspace-theme="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" class="editor-app conversation-editor"></main><script src="/fixture.js"></script></body></html>'],
  ['/fixture.js', bundle.outputFiles.find(file => file.path.endsWith('.js')).text],
  ['/fixture.css', bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '\n*{box-sizing:border-box}body{margin:0;background:#171717;font:12px Arial}#root{display:block;width:720px;height:560px;padding:0;margin:20px auto}.fixture-stage{width:720px;height:480px;display:flex;flex:none}.canvas-toolbar{height:36px;display:flex}button{font:inherit;border:0}'],
  ['/source.png', await readFile(join(directory, 'source.png'))], ['/source.mp4', await readFile(join(directory, 'source.mp4'))],
  ['/vendor/visual-effects.js', runtime.outputFiles[0].text],
]);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://fixture').pathname, value = files.get(path) ?? await readFile('public' + path);
    response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
    response.end(value);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage(), errors = [], checks = [], stackChecks = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(12000);
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
const grade = { enabled: true, exposure: .01, contrast: 1, saturation: 1, temperature: 0, tint: 0, vibrance: 0 };
async function patch(value) { await page.evaluate(value => window.patchClip(value), value); await settle(); }
async function zoom(label) { await page.click('.preview-zoom-trigger'); await page.locator(`::-p-aria([name="${label}"][role="menuitemradio"])`).click(); await settle(); }
async function sample() {
  const geometry = await page.evaluate(() => {
    const player = document.querySelector('hyperframes-player'), doc = player.iframeElement.contentDocument, output = doc.querySelector('.visual-effect-output'), source = doc.querySelector('video,img.visual');
    const viewport = document.querySelector('.preview-viewport').getBoundingClientRect(), sourceRect = source.getBoundingClientRect(), frameRect = player.iframeElement.getBoundingClientRect();
    const composition = doc.getElementById('composition'), scale = frameRect.width / Number(composition.dataset.width);
    const a = output?.getBoundingClientRect();
    return { viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }, output: output ? { width: output.width, height: output.height, cssWidth: a.width * scale, cssHeight: a.height * scale } : null, source: { width: sourceRect.width, height: sourceRect.height, left: source.style.left, top: source.style.top, fit: source.style.objectFit }, dpr: devicePixelRatio };
  });
  const box = geometry.viewport, shot = await page.screenshot({ clip: { x: Math.round(box.x + box.width / 2 - 128), y: Math.round(box.y + box.height / 2), width: 256, height: 4 } });
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const values = Array.from({ length: info.width }, (_, x) => data[x * 3]), mean = values.reduce((a, b) => a + b) / values.length;
  const contrast = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { ...geometry, contrast };
}
async function compare(label) {
  await patch({ colorGrade: { ...grade, enabled: false } }); const native = await sample();
  await patch({ colorGrade: grade }); const graded = await sample();
  assert.ok(graded.output, `${label}: the real color shader has produced its replacement canvas.`);
  assert.deepEqual(graded.source, native.source, `${label}: grading preserves the source crop, fit and placement.`);
  const result = { label, nativeContrast: +native.contrast.toFixed(2), gradedContrast: +graded.contrast.toFixed(2), retention: +(graded.contrast / native.contrast).toFixed(3), ...graded };
  checks.push(result);
  return result;
}
try {
  for (const media of ['video', 'image']) for (const dpr of [1, 2]) {
    const label = media + ' ' + dpr + 'x';
    await page.setViewport({ width: 1040, height: 700, deviceScaleFactor: dpr });
    await page.goto(`http://127.0.0.1:${server.address().port}/?media=${media}`, { waitUntil: 'load' });
    await page.waitForFunction(kind => {
      const player = document.querySelector('hyperframes-player'), source = player?.iframeElement?.contentDocument?.querySelector(kind === 'video' ? 'video' : 'img.visual');
      return player?.ready && !document.querySelector('.preview-loading') && (kind === 'video' ? source?.readyState >= 2 && !source.seeking : source?.complete);
    }, {}, media);
    await compare(`${label}: Fit`);
    // Keep the graded canvas alive while changing only the viewing zoom.
    await zoom('100%'); const beforeReapply = await sample();
    checks.push({ label: `${label}: retained Fit → 100%`, ...beforeReapply, retention: beforeReapply.contrast / (await (async () => { await patch({ colorGrade: { ...grade, enabled: false } }); return sample(); })()).contrast });
    await compare(`${label}: 100%`);
    await page.focus('.preview-viewport'); await page.keyboard.press('ArrowRight'); await settle();
    await compare(`${label}: panned 100%`);
    await zoom('Fit to preview'); await compare(`${label}: Fit before resize`);
    await page.evaluate(() => { document.querySelector('#root').style.width = '960px'; document.querySelector('.fixture-stage').style.width = '960px'; document.querySelector('.fixture-stage').style.height = '600px'; });
    await settle(); const resized = await sample();
    checks.push({ label: `${label}: retained Fit resize`, ...resized, retention: 1 });
    await patch({ crop: { left: .1, right: .1, top: .1, bottom: .1 }, fit: 'contain' });
    await zoom('100%'); await compare(`${label}: cropped contain 100%`);
    await patch({ fit: 'cover' }); await compare(`${label}: cropped cover 100%`);
    if (media === 'video' && dpr === 1) {
      const color = await sample();
      await patch({ softBlur: { enabled: true, amount: 1 } }); const stacked = await sample();
      assert.ok(stacked.output.width < color.output.width, 'Spatial multi-pass effects retain their existing preview work budget.');
      await patch({ softBlur: { enabled: false, amount: 0 } }); const restored = await sample();
      assert.equal(restored.output.width, color.output.width, 'Returning to color alone restores its full detail without replacing the source.');
      stackChecks.push({ colorWidth: color.output.width, stackedWidth: stacked.output.width, restoredWidth: restored.output.width });
      await patch({ crop: { left: 0, right: 0, top: 0, bottom: 0 } });
      const playing = await page.evaluate(async () => {
        const player = document.querySelector('hyperframes-player'), doc = player.iframeElement.contentDocument, source = doc.querySelector('video'), canvas = doc.querySelector('.visual-effect-output'), gl = canvas.getContext('webgl');
        const original = gl.drawArrays; let draws = 0;
        gl.drawArrays = function (...args) { draws++; return original.apply(this, args); };
        player.seek(0); await new Promise(resolve => setTimeout(resolve, 100));
        const before = canvas.toDataURL(), beforeTime = source.currentTime;
        player.play(); await new Promise(resolve => setTimeout(resolve, 2200));
        const result = { advanced: source.currentTime - beforeTime, changed: canvas.toDataURL() !== before, draws, sameSource: doc.querySelector('video') === source, sameCanvas: doc.querySelector('.visual-effect-output') === canvas };
        player.pause(); await new Promise(resolve => setTimeout(resolve, 250)); const pausedDraws = draws;
        await new Promise(resolve => setTimeout(resolve, 250)); result.pausedDraws = draws - pausedDraws;
        gl.drawArrays = original; return result;
      });
      assert.ok(playing.advanced > .5 && playing.changed && playing.draws > 1, 'A graded playing video advances its native source and rendered frame.');
      assert.equal(playing.sameSource && playing.sameCanvas, true, 'Playback retains the decoded source and color canvas.');
      assert.equal(playing.pausedDraws, 0, 'A settled paused grade does not keep drawing.');
      stackChecks.push({ playback: playing });
    }
    assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
  }
  console.log(JSON.stringify({ checks: checks.map(({ label, nativeContrast, gradedContrast, retention, output }) => ({ label, nativeContrast, gradedContrast, retention: +retention.toFixed(3), bitmap: output ? `${output.width}×${output.height}` : null })), stackChecks }, null, 2));
  assert.deepEqual(errors, []);
  assert.ok(checks.every(c => c.output), 'Every graded check must exercise the real shader canvas.');
  const lowDensity = checks.filter(c => c.output && (c.output.width + 2 < Math.min(1920, c.output.cssWidth * c.dpr) || c.output.height + 2 < Math.min(1080, c.output.cssHeight * c.dpr)));
  const blurred = checks.filter(c => c.retention < .8);
  assert.deepEqual(lowDensity.map(c => ({ label: c.label, output: c.output })), [], 'A color canvas must track the current displayed pixel density after zoom, resize, crop and pan.');
  assert.deepEqual(blurred.map(c => ({ label: c.label, retention: c.retention })), [], 'A tiny exposure adjustment must retain native high-frequency detail.');
  console.log('PASS: color grading retains source detail and display density across Fit, 100%, pan, resize and cropped contain/cover. Generated footage only.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
