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
  import {Preview} from './components/editor/preview';import {TimelinePanel} from './components/editor/timeline';import {TooltipProvider} from './components/ui/tooltip';import{PreviewInspector}from'./components/editor/preview-inspector';
  import{EditorStateProvider,useEditorState}from'./components/editor/editor-state';import{createEditorStore}from'./lib/editor/store';
  import{addEffectClip,patchClip,convertSolidColorToVisual}from'./lib/editor/operations';import{DEFAULT_SOLID_COLOR}from'./lib/editor/clip-effects';import './app/editor.css';
  const initial={fps:30,aspectRatio:'landscape',clips:[{id:'base',kind:'image',assetId:'green',start:0,duration:5,sourceStart:0}]};
  const store=createEditorStore(initial),assets=[{_id:'green',kind:'image',fileName:'Owned green fixture',width:32,height:18,url:location.origin+'/green.svg'}];
  function Fixture(){const timeline=useEditorState(s=>s.timeline),selected=useEditorState(s=>s.selectedId),ref=useRef(null),rectangle=timeline.clips.find(c=>c.id==='rectangle');
    window.fixture={shrink:()=>store.getState().edit(patchClip(timeline,'base',{transform:{x:.5,y:.5,scale:.5,rotation:0,opacity:1}})),legacy:()=>store.getState().edit({...timeline,tracks:{...timeline.tracks,effects:1},clips:[timeline.clips[0],{id:'rectangle',kind:'effect',effectPreset:'solid-color',track:1,start:1,duration:2,sourceStart:0,solidColor:{...DEFAULT_SOLID_COLOR,color:'#ff0000'}}]}),select:id=>store.setState({selectedId:id,selectedIds:[id]}),seek:t=>ref.current.seek(t),timeline:()=>store.getState().timeline,remove:()=>store.getState().edit({...timeline,clips:timeline.clips.filter(c=>c.id!=='rectangle')})};
    return <><div className="stage"><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted onTime={()=>{}} onPlaying={()=>{}} onError={error=>(window.errors??=[]).push(error)}/></div>
      <PreviewInspector clip={rectangle??timeline.clips[0]} assets={assets} upload={null} onUpload={()=>{}} onAdd={()=>{}} onClose={()=>{}} onCrop={()=>{}} onChange={patch=>store.getState().edit(patchClip(timeline,'rectangle',patch))} onPreviewEffects={patch=>ref.current.clipEffects('rectangle',patch)} onConvertSolidColor={()=>store.getState().edit(convertSolidColorToVisual(timeline,'rectangle'))} onAddEffect={preset=>store.getState().edit(addEffectClip(timeline,'rectangle',preset,1,{duration:2}))}/><div className="timeline-stage"><TimelinePanel timeline={timeline} assets={assets} selected={selected} onSelect={id=>store.setState({selectedId:id,selectedIds:[id]})} time={0} playing={false} onSeek={()=>{}} onChange={t=>store.getState().edit(t)} onSplit={()=>{}} onDelete={()=>{}} onDuplicate={()=>{}} onAddText={()=>{}}/></div></>;
  }createRoot(document.getElementById('root')).render(<TooltipProvider><EditorStateProvider store={store}><Fixture/></EditorStateProvider></TooltipProvider>);` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-solid-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const runtime = await build({ entryPoints: ['lib/editor/visual-effects-runtime.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: '__revlineVisualEffects', write: false });
const js = bundle.outputFiles.find(file => file.path.endsWith('.js')).text, css = bundle.outputFiles.find(file => file.path.endsWith('.css')).text;
let exported;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const files = { '/fixture.js': js, '/fixture.css': css, '/vendor/visual-effects.js': runtime.outputFiles[0].text, '/green.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="#00ff00"/></svg>', '/export': exported };
  let body = files[path];
  if (path.startsWith('/vendor/') || path.startsWith('/fonts/')) body ??= await readFile('public' + path).catch(() => null);
  if (!body) body = '<link rel="stylesheet" href="/fixture.css"><style>body{margin:0}.stage{width:640px;height:360px}.preview-canvas{width:640px;height:360px;position:relative}.hyperframes-host{position:absolute;inset:0}.preview-inspector{position:absolute;left:650px;top:0;width:300px;height:420px}.timeline-stage{width:960px;height:260px;display:flex;margin-top:70px}.timeline-panel{width:100%}</style><div id="root"></div><script src="/fixture.js"></script>';
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
  // Cinematic looks now lead the Color category (10232a5); the fixture timeline starts below the 420px inspector so it cannot cover library rows.
  await page.click('[data-category="color"]');await page.click('button[aria-label="Solid color"]'); await page.waitForSelector('[aria-label="Solid color rectangle settings"]');
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
  assert.equal(saved.clips.find(c=>c.id==='rectangle').kind,'solid','New color is a V layer');
  await page.evaluate(()=>window.fixture.select('rectangle'));await flush();
  const colorBox=await page.$eval('[data-clip-id="rectangle"]',node=>{const r=node.getBoundingClientRect();return {x:r.left+40,y:r.top+r.height/2};});
  const below=await page.$eval('.timeline-track[data-group="visual"][data-layer="1"]',node=>node.getBoundingClientRect().bottom+2);
  await page.mouse.move(colorBox.x,colorBox.y);await page.mouse.down();await page.mouse.move(colorBox.x,below,{steps:12});await flush();await page.mouse.up();await flush();
  const behind=await page.evaluate(()=>window.fixture.timeline());
  assert.equal(behind.clips.find(c=>c.id==='rectangle').track,1,'Dragging below V1 creates a color background row');
  assert.equal(behind.clips.find(c=>c.id==='base').track,2,'Footage moves above the inserted background');
  await rgb('.stage',.5,.5,[0,255,0],'Opaque footage appears over a lower solid color');
  await page.evaluate(()=>window.fixture.shrink());await flush();
  await rgb('.stage',.5,.5,[0,255,0],'Smaller footage remains in front of its color background');
  await rgb('.stage',.1,.1,[255,0,0],'Lower V color fills unused canvas around footage');
  await page.evaluate(()=>window.fixture.legacy());await flush();
  await rgb('.stage',.5,.5,[255,0,0],'Saved legacy FX color still overlays footage');
  await page.click('button[aria-label="Move solid color to visual layer"]');await flush();
  assert.equal((await page.evaluate(()=>window.fixture.timeline())).clips.find(c=>c.id==='rectangle').kind,'solid','Explicit conversion changes legacy FX to a V layer');
  await rgb('.stage',.5,.5,[0,255,0],'Explicitly converted color can appear behind existing footage');
  await rgb('.stage',.1,.1,[255,0,0],'Converted color retains its background color and size');
  await page.evaluate(() => window.fixture.remove()); await flush();
  assert.equal(await page.evaluate(() => { const p = document.querySelector('hyperframes-player'); return p === window.original.player && p.iframeElement.contentDocument === window.original.doc && p.iframeElement.contentDocument.querySelector('[data-source-clip="base"]') === window.original.source && !p.iframeElement.contentDocument.querySelector('.solid-color-rectangle'); }), true, 'Add/edit/remove shape keeps the original player and source mounted, with no orphan rectangle');
  exported = generateComposition(empty, [], { gsapUrl: origin + '/vendor/gsap.min.js', visualEffectsUrl: origin + '/vendor/visual-effects.js' });
  await page.evaluate(origin => { document.getElementById('exported').src = origin + '/export?empty=1'; }, origin);
  await page.waitForFunction(() => document.getElementById('exported').contentWindow.__revlineAdjustmentController && !document.getElementById('exported').contentDocument.querySelector('img'));
  await flush(); await rgb('#exported', .75, .5, [37, 99, 235], 'Asset-free solid rectangle fills an otherwise empty composition');
  assert.deepEqual(errors, []); assert.deepEqual(await page.evaluate(() => window.errors ?? []), []);
  console.log('PASS: real inspector/library add action opening rectangle controls, default full frame, native color control, keyboard size/position/opacity edits, actual preview/export pixels, V-track creation, real drag beneath footage, explicit legacy FX conversion, exact end, fill-frame reset, validation and retained-source cleanup. Owned synthetic footage only.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
