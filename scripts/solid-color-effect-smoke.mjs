import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition.ts';
import { addEffectClip } from '../lib/editor/operations.ts';
import { validateClipEffects } from '../lib/editor/clip-effects.ts';
import { EMPTY_TIMELINE } from '../lib/editor/types.ts';

const require = createRequire(import.meta.url), sharp = require('sharp');
const empty = addEffectClip({ ...EMPTY_TIMELINE, aspectRatio: 'landscape' }, 'empty-frame', 'solid-color', 0);
assert.equal(empty.clips[0].solidColor.width, 1, 'Adding the preset creates a full-frame rectangle without media');
assert.doesNotThrow(() => generateComposition(empty, []));
for (const patch of [{ color: 'url(javascript:bad)' }, { width: Infinity }, { height: 0 }, { opacity: 2 }]) assert.throws(() => validateClipEffects({ ...empty.clips[0], solidColor: { ...empty.clips[0].solidColor, ...patch } }));
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
  import React,{useRef} from 'react';import{createRoot}from'react-dom/client';
  import {Preview} from './components/editor/preview';import{PreviewInspector}from'./components/editor/preview-inspector';
  import{EditorStateProvider,useEditorState}from'./components/editor/editor-state';import{createEditorStore}from'./lib/editor/store';
  import{addEffectClip,patchClip}from'./lib/editor/operations';import './app/editor.css';
  const initial={fps:30,aspectRatio:'landscape',clips:[{id:'base',kind:'image',assetId:'green',start:0,duration:5,sourceStart:0}]};
  const store=createEditorStore(initial),assets=[{_id:'green',kind:'image',fileName:'Owned green fixture',width:32,height:18,url:location.origin+'/green.svg'}];
  function Fixture(){const timeline=useEditorState(s=>s.timeline),ref=useRef(null),rectangle=timeline.clips.find(c=>c.id==='rectangle');
    window.fixture={seek:t=>ref.current.seek(t),timeline:()=>store.getState().timeline,remove:()=>store.getState().edit({...timeline,clips:timeline.clips.filter(c=>c.id!=='rectangle')})};
    return <><div className="stage"><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted onTime={()=>{}} onPlaying={()=>{}} onError={error=>(window.errors??=[]).push(error)}/></div>
      <PreviewInspector clip={rectangle??timeline.clips[0]} assets={assets} upload={null} onUpload={()=>{}} onAdd={()=>{}} onClose={()=>{}} onCrop={()=>{}} onChange={patch=>store.getState().edit(patchClip(timeline,'rectangle',patch))} onPreviewEffects={patch=>ref.current.clipEffects('rectangle',patch)} onAddEffect={preset=>store.getState().edit(addEffectClip(timeline,'rectangle',preset,1,{duration:2}))}/></>;
  }createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-solid-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const runtime = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
let exported;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const files = { '/fixture.js': js, '/fixture.css': css, '/vendor/visual-effects.js': runtime.outputFiles[0].text, '/green.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#00ff00"/></svg>', '/export': exported };
  let body = files[path];
  if (path.startsWith('/vendor/') || path.startsWith('/fonts/')) body ??= await readFile('public' + path).catch(() => null);
  if (!body) body = '<link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.stage{width:640px;height:360px}.preview-canvas{width:640px;height:360px;position:relative}.hyperframes-host{position:absolute;inset:0}.preview-inspector{width:300px}</style><div id="root"></div><script src="/fixture.js"></script>';
  res.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.woff2') ? 'font/woff2' : 'text/html' }); res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=768'] });
const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(8000);
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function rgb(selector, x, y, target, label) {
  const buffer = await (await page.$(selector)).screenshot(), { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const at = (Math.floor(y * info.height) * info.width + Math.floor(x * info.width)) * info.channels, actual = [...data.subarray(at, at + 3)];
  assert.ok(actual.every((value, index) => Math.abs(value - target[index]) <= 4), label + ': ' + actual.join(','));
}
async function range(label, count) {
  await page.focus('input[aria-label="' + label + '"]'); await page.keyboard.press('Home');
  for (let index = 0; index < count; index++) await page.keyboard.press('ArrowRight');
  await flush();
}
try {
  await page.setViewport({ width: 1000, height: 900 }); await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.style.zIndex === '1');
  await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); window.original = { player: p, doc: p.iframeElement.contentDocument, source: p.iframeElement.contentDocument.querySelector('[data-source-clip="base"]') }; });
  await page.click('button[aria-label="Solid color"]'); await page.waitForSelector('[aria-label="Solid color rectangle settings"]');
  await page.evaluate(() => window.fixture.seek(1.5)); await flush();
  await rgb('.stage', .5, .5, [37, 99, 235], 'New solid effect fills the preview frame');
  await page.$eval('[aria-label="Rectangle color"]', node => { node.value = '#ff0000'; node.dispatchEvent(new Event('change', { bubbles: true })); }); await flush();
  await range('Width', 49); await range('Height', 49); await range('Position X', 25); await range('Opacity', 50);
  await rgb('.stage', .25, .5, [128, 128, 0], 'Rectangle color and opacity blend over footage');
  await rgb('.stage', .75, .5, [0, 255, 0], 'Resizing and moving the rectangle preserves footage outside it');
  const saved = await page.evaluate(() => window.fixture.timeline());
  exported = generateComposition(saved, [{ _id: 'green', kind: 'image', fileName: 'Owned fixture', width: 32, height: 18, url: origin + '/green.svg' }], { gsapUrl: origin + '/vendor/gsap.min.js', visualEffectsUrl: origin + '/vendor/visual-effects.js' });
  await page.evaluate(origin => { const frame = document.createElement('iframe'); frame.id = 'exported'; frame.style.cssText = 'display:block;width:1920px;height:1080px;border:0;transform:scale(.3333333333);transform-origin:top left'; frame.src = origin + '/export'; document.body.appendChild(frame); }, origin);
  await page.waitForFunction(() => document.getElementById('exported').contentWindow.__revlineAdjustmentController);
  await page.evaluate(async () => { const frame = document.getElementById('exported').contentWindow; await frame.document.querySelector('img').decode(); frame.__timelines.revline.seek(1.5); }); await flush();
  await rgb('#exported', .25, .5, [128, 128, 0], 'Export composition renders saved rectangle settings with the same controller');
  await rgb('#exported', .75, .5, [0, 255, 0], 'Export rectangle dimensions and position match preview');
  await page.evaluate(() => window.fixture.seek(3)); await flush(); await rgb('.stage', .25, .5, [0, 255, 0], 'Rectangle clears exactly at the effect end');
  await page.evaluate(() => window.fixture.seek(1.5)); await flush(); await page.click('.effect-color-reset'); await flush();
  await rgb('.stage', .75, .5, [255, 0, 0], 'Fill frame restores size, position and opacity while retaining color');
  await page.evaluate(() => window.fixture.remove()); await flush();
  assert.equal(await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); return p === window.original.player && p.iframeElement.contentDocument === window.original.doc && p.iframeElement.contentDocument.querySelector('[data-source-clip="base"]') === window.original.source && !p.iframeElement.contentDocument.querySelector('.solid-color-rectangle'); }), true, 'Add/edit/remove shape keeps the original player and source mounted, with no orphan rectangle');
  exported = generateComposition(empty, [], { gsapUrl: origin + '/vendor/gsap.min.js', visualEffectsUrl: origin + '/vendor/visual-effects.js' });
  await page.evaluate(origin => { document.getElementById('exported').src = origin + '/export?empty=1'; }, origin);
  await page.waitForFunction(() => document.getElementById('exported').contentWindow.__revlineAdjustmentController && !document.getElementById('exported').contentDocument.querySelector('img'));
  await flush(); await rgb('#exported', .75, .5, [37, 99, 235], 'Asset-free solid rectangle fills an otherwise empty composition');
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.errors ?? []), []);
  console.log('PASS: real inspector/library add action opening rectangle controls, default full frame, native color control, keyboard size/position/opacity edits, actual preview/export pixels, exact end, fill-frame reset, validation and retained-source cleanup. Owned synthetic footage only.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
