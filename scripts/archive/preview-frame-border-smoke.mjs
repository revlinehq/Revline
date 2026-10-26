import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const directory = await mkdtemp(join(tmpdir(), 'revline-preview-border-'));
const source = await sharp({ create: { width: 360, height: 640, channels: 3, background: '#d04f32' } }).png().toBuffer();
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0xd04f32:s=360x640:r=30', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'source.mp4')]);
const video = await readFile(join(directory, 'source.mp4'));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';
import {Preview} from './components/editor/preview';import {PreviewViewport,PreviewZoomControls,PreviewZoomProvider} from './components/editor/preview-zoom';
import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import './app/editor.css';
const kind=new URLSearchParams(location.search).get('media')==='video'?'video':'image';
const clip={id:'source',assetId:'source',kind,track:1,start:0,duration:2,sourceStart:0};
const timeline={fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[clip]};
const assets=[{_id:'source',kind,fileName:'Generated solid footage',width:360,height:640,url:location.origin+(kind==='video'?'/source.mp4':'/source.png')}];
const store=createEditorStore(timeline);window.fixtureErrors=[];
createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><PreviewZoomProvider canvas={{width:1080,height:1920}}><div className="canvas-toolbar"><PreviewZoomControls/></div><div className="stage-center fixture-stage"><PreviewViewport><Preview timeline={timeline} assets={assets} time={0} selectedClip={clip} onSelectClip={()=>{}} onVisualChange={()=>{}} onTime={()=>{}} onPlaying={()=>{}} onError={error=>window.fixtureErrors.push(error)} muted/></PreviewViewport></div></PreviewZoomProvider></EditorStateProvider>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-preview-border-bundle', define: { 'process.env.NODE_ENV': '"production"' } });
const runtime = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const files = new Map([
  ['/', '<!doctype html><html data-workspace-theme="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" class="editor-app conversation-editor"></main><script src="/fixture.js"></script></body></html>'],
  ['/fixture.js', bundle.outputFiles.find(file => file.path.endsWith('.js')).text],
  ['/fixture.css', bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '\n*{box-sizing:border-box}body{margin:0;background:#171717;font:12px Arial}#root{display:block;width:720px;height:560px;padding:0;margin:20px auto}.fixture-stage{width:720px;height:480px;display:flex;flex:none}.canvas-toolbar{height:36px;display:flex}button{font:inherit;border:0}'],
  ['/source.png', source], ['/source.mp4', video],
  ['/vendor/visual-effects.js', runtime.outputFiles[0].text],
]);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://fixture').pathname;
    const value = files.get(path) ?? await readFile('public' + path);
    response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
    response.end(value);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=384'] });
const page = await browser.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(12000);
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function checkEdges(label) {
  await flush();
  const geometry = await page.evaluate(() => {
    const frame = document.querySelector('.preview-viewport-frame'), rect = frame.getBoundingClientRect();
    const bounds = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const edge = getComputedStyle(frame, '::after');
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, dpr: devicePixelRatio, frame: bounds('.preview-viewport-frame'), canvas: bounds('.preview-canvas'), host: bounds('.hyperframes-host'), border: edge.border, inset: edge.inset, shadow: edge.boxShadow, focused: document.querySelector('.preview-viewport').matches(':focus-visible'), guides: !!document.querySelector('.preview-safe-guides'), selection: !!document.querySelector('.visual-selection-box') };
  });
  const shot = await page.screenshot(), { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
  // Compare with the same painted media without its frame decoration. This
  // separates overlay pixels from Chromium's image-edge resampling at zoom.
  const referenceStyle = await page.addStyleTag({ content: '.preview-viewport-frame:after{opacity:0!important}' });
  const reference = await sharp(await page.screenshot()).raw().toBuffer();
  await referenceStyle.evaluate(node => node.remove());
  const { left, right, top, bottom, dpr } = geometry;
  // Fully contained pixels only: avoid antialiasing at fractional outer bounds.
  const x0 = Math.ceil(left * dpr), x1 = Math.floor(right * dpr) - 1, y0 = Math.ceil(top * dpr), y1 = Math.floor(bottom * dpr) - 1;
  let obstructed = 0, sampled = 0, outsideFocusPixels = 0;
  const samples = new Set();
  for (let depth = 0; depth < 2 * dpr; depth++) {
    for (let x = x0 + 8 * dpr; x <= x1 - 8 * dpr; x++) { samples.add((y0 + depth) * info.width + x); samples.add((y1 - depth) * info.width + x); }
    for (let y = y0 + 8 * dpr; y <= y1 - 8 * dpr; y++) { samples.add(y * info.width + x0 + depth); samples.add(y * info.width + x1 - depth); }
  }
  for (const pixel of samples) {
    const at = pixel * info.channels;
    sampled++;
    if ([0, 1, 2].some(channel => Math.abs(data[at + channel] - reference[at + channel]) > 4)) obstructed++;
  }
  // The focus ring uses the shared violet accent (049b1e3), read from the page rather than hard-coded.
  const accent = await page.evaluate(() => { const probe = document.createElement('div'); probe.style.color = 'var(--revline-accent)'; document.body.append(probe); const rgb = getComputedStyle(probe).color.match(/\d+/g).slice(0, 3).map(Number); probe.remove(); return rgb; });
  assert.ok(accent.some(channel => channel > 40) && Math.max(...accent) - Math.min(...accent) > 40, 'The accent token resolves to a saturated color: ' + accent);
  const center = (Math.floor((top + bottom) * dpr / 2) * info.width + Math.floor((left + right) * dpr / 2)) * info.channels;
  assert.ok(Math.abs(data[center] - 208) < 6 && Math.abs(data[center + 1] - 79) < 6 && Math.abs(data[center + 2] - 50) < 6, 'The generated source is actually painted before checking its edges.');
  for (let y = Math.floor((top - 3) * dpr); y < Math.ceil((bottom + 3) * dpr); y++) for (let x = Math.floor((left - 3) * dpr); x < Math.ceil((right + 3) * dpr); x++) {
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
    const at = (y * info.width + x) * info.channels;
    if (Math.abs(data[at] - accent[0]) < 6 && Math.abs(data[at + 1] - accent[1]) < 6 && Math.abs(data[at + 2] - accent[2]) < 6) outsideFocusPixels++;
  }
  const result = { label, obstructed, sampled, outsideFocusPixels, ...geometry }; checks.push(result);
  if (obstructed && !checks.slice(0, -1).some(check => check.obstructed)) await page.screenshot({ path: '/tmp/revline-preview-border-before.png' });
  if (!obstructed && label === 'image 1x fit idle') await page.screenshot({ path: '/tmp/revline-preview-border-after.png' });
  return result;
}
try {
  for (const media of ['image', 'video']) for (const dpr of [1, 2]) {
    await page.setViewport({ width: 800, height: 620, deviceScaleFactor: dpr });
    await page.goto(`http://127.0.0.1:${server.address().port}/?media=${media}`, { waitUntil: 'load' });
    await page.waitForFunction(kind => {
      const player = document.querySelector('hyperframes-player'), source = player?.iframeElement?.contentDocument?.querySelector(kind === 'video' ? 'video' : 'img.visual');
      return player?.ready && !document.querySelector('.preview-loading') && (kind === 'video' ? source?.readyState >= 2 : source?.complete);
    }, {}, media);
    await page.evaluate(() => { const player = document.querySelector('hyperframes-player'); window.original = { player, document: player.iframeElement.contentDocument, source: player.iframeElement.contentDocument.querySelector('video,img.visual') }; });
    for (const zoom of ['fit', '25%']) {
      if (zoom !== 'fit') { await page.click('.preview-zoom-trigger'); await page.locator('::-p-aria([name="25%" ][role="menuitemradio"])').click(); }
      await checkEdges(`${media} ${dpr}x ${zoom} idle`);
      await page.focus('.preview-viewport');
      await checkEdges(`${media} ${dpr}x ${zoom} keyboard focus`);
      await page.evaluate(() => document.activeElement.blur());
    }
    assert.equal(await page.evaluate(() => { const player = document.querySelector('hyperframes-player'); return player === window.original.player && player.iframeElement.contentDocument === window.original.document && player.iframeElement.contentDocument.contains(window.original.source); }), true, 'Zoom and focus retain the player and decoded source.');
    await page.click('[aria-label="Show safe guides"]'); await page.waitForSelector('.preview-safe-area');
    assert.equal(await page.$eval('.preview-safe-guides', node => getComputedStyle(node).pointerEvents), 'none');
    await page.click('[aria-label="Hide safe guides"]');
    assert.equal(await page.$('.preview-safe-guides'), null);
    await page.click('.preview-hit-surface', { count: 2 }); await page.waitForSelector('.visual-corner');
    assert.equal((await page.$$('.visual-corner')).length, 4, 'The frame decoration must not remove transform controls.');
  }
  console.log(JSON.stringify({ checks: checks.length, failed: checks.filter(check => check.obstructed) }, null, 2));
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.fixtureErrors), []);
  assert.ok(checks.every(check => check.obstructed === 0), 'The preview frame/focus decoration must not cover the first two pixels of source footage.');
  assert.ok(checks.filter(check => check.label.endsWith('keyboard focus')).every(check => check.focused && check.outsideFocusPixels > 0), 'Keyboard focus remains visible outside the source frame.');
  console.log('PASS: actual Preview + viewport has no inside frame/focus border for image/native video at fit and 25%, 1x/2x; guides and transform handles remain available, player/source retained. Generated footage only.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
