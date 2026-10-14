import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { tsImport } from 'tsx/esm/api';

const compositionModule = await tsImport('../lib/editor/composition.ts', import.meta.url);
const generateComposition = compositionModule.generateComposition ?? compositionModule.default.generateComposition;
const renderModule = await tsImport('../lib/server/render-worker.ts', import.meta.url);
const runRenderWorker = renderModule.runRenderWorker ?? renderModule.default.runRenderWorker;
const directory = await mkdtemp(join(tmpdir(), 'revline-neon-edges-'));
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 480 270"><rect width="480" height="270" fill="#242424"/><rect x="15" y="40" width="20" height="190" fill="#3c3c3c"/><rect x="80" y="55" width="120" height="145" rx="16" fill="#e0e0e0"/><circle cx="345" cy="135" r="65" fill="#b0b0b0"/><path d="M220 225 260 35" stroke="#ffffff" stroke-width="14"/></svg>';
const source = await sharp(Buffer.from(svg)).png().toBuffer();
await writeFile(join(directory, 'source.png'), source);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-threads', '1', '-loop', '1', '-i', join(directory, 'source.png'), '-f', 'lavfi', '-i', 'color=white:s=20x20:r=30:d=3', '-filter_complex_threads', '1', '-filter_complex', "[0:v][1:v]overlay=x='mod(t*120,600)':y=20:shortest=1", '-t', '3', '-r', '30', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(directory, 'source.mp4')]);
const video = await readFile(join(directory, 'source.mp4'));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';import {Preview} from './components/editor/preview';import {VisualEffectsControls} from './components/editor/visual-effects-controls';import {EditorStateProvider,useEditorState} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import {patchClip} from './lib/editor/operations';import {DEFAULT_NEON_EDGES} from './lib/editor/neon-edges';import './app/editor.css';import './components/workspace/workspace-pages.css';
const kind=new URLSearchParams(location.search).get('media')==='video'?'video':'image';
const clip={id:'source',kind,assetId:'source',track:1,start:0,duration:2.4,sourceStart:.2,volume:.6,invert:{enabled:false,amount:.2}},store=createEditorStore({fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[clip]});
const assets=[{_id:'source',kind,fileName:'Generated geometry',width:640,height:360,url:location.origin+(kind==='video'?'/source.mp4':'/source.png')}];window.errors=[];window.commits=[];window.previews=[];window.readbacks=0;
function Fixture(){const preview=useRef(null),timeline=useEditorState(state=>state.timeline),selected=timeline.clips[0];const change=patch=>{window.commits.push(patch);store.getState().edit(patchClip(store.getState().timeline,'source',patch));};window.fixture={store,patch:change,neon:patch=>change({neonEdges:{...DEFAULT_NEON_EDGES,...store.getState().timeline.clips[0].neonEdges,...patch}}),seek:time=>preview.current.seek(time),play:()=>preview.current.play(),pause:()=>preview.current.pause(),resetCounters:()=>{window.commits=[];window.previews=[]}};
return <><div className="stage"><Preview ref={preview} timeline={timeline} assets={assets} time={.3} muted selectedClip={selected} onTime={time=>store.setState({playhead:time})} onPlaying={playing=>store.setState({playing})} onError={error=>window.errors.push(error)}/></div><aside className="preview-inspector"><VisualEffectsControls clip={selected} onlyEffect={selected.neonEdges?'neonEdges':undefined} onChange={change} onPreview={patch=>{window.previews.push(patch);preview.current.clipEffects('source',patch)}}/></aside></>};createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);
` }, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', write: false, outdir: '/tmp/revline-neon-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const runtime = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const files = new Map([
  ['/', '<!doctype html><html data-workspace-theme="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><main id="root" class="editor-app"></main><script src="/fixture.js"></script></body></html>'],
  ['/fixture.js', bundle.outputFiles.find(file => file.path.endsWith('.js')).text],
  ['/fixture.css', bundle.outputFiles.find(file => file.path.endsWith('.css')).text + '\n*{box-sizing:border-box}body{margin:0;font:12px Arial;background:#171717}#root{display:flex;flex-direction:row;width:1000px;height:430px;gap:20px;padding:20px}.stage,.preview-canvas{position:relative;width:640px;height:360px;flex-shrink:0;border:0!important;border-radius:0!important}.preview-inspector{width:300px;min-width:0;height:390px;overflow:auto;padding:8px}.visual-effects-menu [role=menuitem]{display:flex;gap:8px;padding:7px}.visual-effects-menu{padding:5px;border-radius:6px}'],
  ['/source.png', source], ['/source.mp4', video], ['/vendor/visual-effects.js', runtime.outputFiles[0].text],
]);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://fixture').pathname;
    const body = files.get(path) ?? (path === '/export' ? await readFile(join(directory, 'index.html')) : await readFile('public' + path));
    const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const headers = { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : path.endsWith('.mp4') ? 'video/mp4' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html', 'Accept-Ranges': 'bytes' };
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
      if (start > end) { response.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end(); return; }
      response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 }); response.end(data.subarray(start, end + 1));
    } else { response.writeHead(200, { ...headers, 'Content-Length': data.length }); response.end(data); }
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=512'] });
let browserClosed = false;
const page = await browser.newPage(), errors = [], measurements = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Revline visual effects')) errors.push(message.text()); });
page.setDefaultTimeout(12000);
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const screenshot = () => page.$('.preview-canvas').then(node => node.screenshot());
const pixels = async shot => (await sharp(shot).resize(640, 360).removeAlpha().raw().toBuffer());
const distance = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
function cyan(data) { let count = 0; for (let i = 0; i < data.length; i += 3) if (data[i + 1] > 100 && data[i + 2] > 100 && data[i] < data[i + 1] * .8) count++; return count; }
async function patch(settings) { await page.evaluate(settings => window.fixture.neon(settings), settings); await flush(); }
async function retain(label) {
  const result = await page.evaluate(() => { const p = document.querySelector('hyperframes-player'), d = p.iframeElement.contentDocument; return { player: p === window.before.player, document: d === window.before.document, source: d.querySelector('video,img.visual') === window.before.source, canvas: !window.before.canvas || d.querySelector('.visual-effect-output') === window.before.canvas, readbacks: window.readbacks, reloads: window.reloads }; });
  assert.equal(result.player, true, label); assert.equal(result.document, true, label); assert.equal(result.source, true, label); assert.equal(result.readbacks, 0, 'The effect performs no WebGL pixel readbacks'); assert.equal(result.reloads, 0, 'Live controls do not reload decoded media');
  return result;
}
try {
  await page.setViewport({ width: 1020, height: 460 });
  let nativePreview;
  for (const media of ['image', 'video']) {
    await page.goto(`${origin}/?media=${media}`, { waitUntil: 'load' });
    await page.waitForFunction(kind => { const p = document.querySelector('hyperframes-player'), n = p?.iframeElement?.contentDocument?.querySelector(kind === 'video' ? 'video' : 'img.visual'); return p?.ready && !document.querySelector('.preview-loading') && (kind === 'video' ? n?.readyState >= 2 && !n.seeking : n?.complete); }, {}, media);
    await page.evaluate(() => {
      const p = document.querySelector('hyperframes-player'), d = p.iframeElement.contentDocument, source = d.querySelector('video,img.visual'); window.before = { player: p, document: d, source }; window.reloads = 0; source.addEventListener('loadstart', () => window.reloads++);
      const proto = d.defaultView.WebGLRenderingContext.prototype, read = proto.readPixels; proto.readPixels = function(...args) { window.readbacks++; return read.apply(this, args); };
    });
    const original = await pixels(await screenshot());
    await page.click('.visual-effects-add'); await page.locator('::-p-aria([name="Neon edges"][role="menuitem"])').click(); await page.waitForSelector('[aria-label="Neon edge color"]'); await flush();
    const baseline = await pixels(await screenshot()), baseCyan = cyan(baseline);
    measurements.push({ media, baseCyan, changed: distance(original, baseline) });
    assert.ok(baseCyan > 150, 'Neon draws actual cyan outlines');
    assert.ok(distance(original, baseline) > 20, 'Neon darkens the source and changes visible pixels');
    const interior = (150 * 640 + 160) * 3; assert.ok(baseline[interior] < 50 && baseline[interior + 1] < 50, 'Flat shape interiors remain dark rather than receiving a full-frame tint');
    await page.evaluate(() => window.before.canvas = document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.visual-effect-output'));
    await patch({ threshold: 1 }); assert.ok(cyan(await pixels(await screenshot())) < baseCyan * .3, 'High threshold suppresses weak outlines');
    await patch({ threshold: .15, glow: 0 }); const noGlow = await pixels(await screenshot());
    await patch({ glow: 1 }); const fullGlow = await pixels(await screenshot()); assert.ok(cyan(fullGlow) > cyan(noGlow), 'Glow adds visible halo pixels');
    await patch({ detail: 0 }); const coarse = await pixels(await screenshot());
    await patch({ detail: 1 }); assert.ok(distance(coarse, await pixels(await screenshot())) > .2, 'Edge detail changes edge geometry');
    await page.click('[aria-label="Reset Neon edges"]'); await flush();
    await page.evaluate(() => window.fixture.resetCounters());
    const strength = await page.$('[data-effect="neonEdges"] input[aria-label="Strength"]'), bounds = await strength.boundingBox();
    await page.mouse.move(bounds.x + bounds.width * .9, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .25, bounds.y + bounds.height / 2, { steps: 6 }); await flush();
    assert.equal(await page.evaluate(() => window.commits.length), 0, 'Live dragging creates no history entries'); assert.equal(await page.evaluate(() => window.fixture.store.getState().timeline.clips[0].neonEdges.amount), .9);
    assert.ok(distance(baseline, await pixels(await screenshot())) > 10, 'Slider drafts repaint before commit');
    await page.mouse.up(); await flush(); assert.equal(await page.evaluate(() => window.commits.length), 1, 'One release commits once');
    await page.evaluate(() => window.fixture.store.getState().undo()); await flush(); assert.ok(distance(baseline, await pixels(await screenshot())) < 1, 'Undo restores original Neon pixels');
    await page.evaluate(() => window.fixture.resetCounters());
    await page.mouse.move(bounds.x + bounds.width * .9, bounds.y + bounds.height / 2); await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height / 2); await flush(); await page.keyboard.press('Escape'); await page.mouse.up(); await flush();
    assert.equal(await page.evaluate(() => window.commits.length), 0, 'Escape discards the draft'); assert.ok(distance(baseline, await pixels(await screenshot())) < 1);
    await page.focus('[data-effect="neonEdges"] input[aria-label="Glow"]'); await page.keyboard.press('End'); await flush(); assert.equal(await page.evaluate(() => window.fixture.store.getState().timeline.clips[0].neonEdges.glow), 1, 'Keyboard edits the actual selected effect');
    await page.evaluate(() => { window.fixture.resetCounters(); const color = document.querySelector('[aria-label="Neon edge color"]'); color.value = '#ff3a9e'; color.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await page.evaluate(() => window.commits.length), 0, 'Color wheel drafts do not repeatedly save');
    await page.$eval('[aria-label="Neon edge color"]', node => node.dispatchEvent(new Event('change', { bubbles: true }))); await flush(); assert.equal(await page.evaluate(() => window.commits.length), 1); assert.ok(distance(fullGlow, await pixels(await screenshot())) > 1, 'Accepted color changes visible outlines');
    await page.click('[aria-label="Enable Neon edges"]'); await flush(); assert.equal(await page.evaluate(() => document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.visual-effect-output')), null, 'Disabled Neon releases its output');
    assert.equal(await page.evaluate(() => window.fixture.store.getState().timeline.clips[0].neonEdges.color), '#ff3a9e', 'Bypass preserves authored values');
    await page.click('[aria-label="Enable Neon edges"]'); await page.click('[aria-label="Reset Neon edges"]'); await flush();
    assert.equal((await retain(`${media} live edits`)).canvas, true, 'Live drafts reuse the existing WebGL canvas');
    assert.deepEqual(await page.evaluate(() => { const { neonEdges, ...clip } = window.fixture.store.getState().timeline.clips[0]; return clip; }), { id: 'source', kind: media, assetId: 'source', track: 1, start: 0, duration: 2.4, sourceStart: .2, volume: .6, invert: { enabled: false, amount: .2 } }, 'Other effects, audio controls and source timing remain intact');
    if (media === 'video') {
      await page.evaluate(() => window.fixture.play()); await page.waitForFunction(() => window.fixture.store.getState().playing);
      const clock = await page.evaluate(() => window.before.source.currentTime); await page.waitForFunction(time => window.before.source.currentTime > time + .15, {}, clock);
      await patch({ glow: .8 }); assert.equal(await page.evaluate(() => window.fixture.store.getState().playing), true); await retain('Playing Neon update');
      await page.evaluate(() => { window.fixture.pause(); window.fixture.seek(.3); }); await page.waitForFunction(() => !window.before.source.seeking && Math.abs(window.before.source.currentTime - .5) < .04); await patch({ glow: .65 }); nativePreview = await pixels(await screenshot());
      await page.screenshot({ path: '/tmp/revline-neon-edges-controls.png' });
    }
    await page.click('[aria-label="Remove Neon edges"]'); await flush(); assert.equal(await page.evaluate(() => window.fixture.store.getState().timeline.clips[0].neonEdges), undefined); await retain(`${media} remove`);
    assert.deepEqual(await page.evaluate(() => window.errors), []);
  }
  const effects = { enabled: true, amount: .9, color: '#36f9f2', detail: .65, threshold: .15, glow: .65 };
  const timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0, effects: 0 }, clips: [{ id: 'source', kind: 'video', assetId: 'source', track: 1, start: 0, duration: .8, sourceStart: .2, volume: 0, neonEdges: effects }] };
  const assets = [{ _id: 'source', kind: 'video', width: 640, height: 360, fileName: 'Generated geometry', url: './source.mp4' }];
  await writeFile(join(directory, 'index.html'), generateComposition(timeline, assets, { resolution: 720, gsapUrl: './gsap.min.js', visualEffectsUrl: './visual-effects.js', fontUrl: './space-grotesk-latin.woff2' }));
  await writeFile(join(directory, 'visual-effects.js'), runtime.outputFiles[0].text); await copyFile('public/vendor/gsap.min.js', join(directory, 'gsap.min.js')); await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory, 'space-grotesk-latin.woff2'));
  assert.deepEqual(errors, []); await browser.close(); browserClosed = true;
  // The UI browser is closed before the renderer starts to keep memory bounded.
  const output = join(directory, 'output.mp4'), result = await runRenderWorker(directory, output, { fps: 24, quality: 'high' }, () => {}, AbortSignal.timeout(90000)); assert.equal(result.warnings, 0);
  const exported = execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', '0.3', '-i', output, '-vf', 'scale=640:360', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const error = distance(nativePreview, exported); assert.ok(error < 8, `Actual preview/MP4 mean RGB difference ${error.toFixed(2)}`); assert.ok(cyan(exported) > 150, 'Encoded MP4 includes luminous edges');
  await copyFile(output, '/tmp/revline-neon-edges-export.mp4');
  console.log(JSON.stringify({ measurements, previewExportMeanRgb: error }, null, 2));
  console.log('PASS: actual image/native-video Neon pixels; live color/strength/detail/threshold/glow, drag/cancel/keyboard/one-commit/undo, playing updates, retained player/media/GPU canvas, no runtime readPixels, unchanged source/audio/other effects, short real MP4 export parity. Generated geometry only.');
} finally { if (!browserClosed) await browser.close(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
