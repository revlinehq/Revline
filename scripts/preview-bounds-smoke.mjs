import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const generatedFixture = !process.env.MEDIA_FIXTURE;
const fixture = process.env.MEDIA_FIXTURE ?? path.join(os.tmpdir(), 'revline-landscape-preview-smoke.png');
if(generatedFixture) await sharp({ create: { width: 1920, height: 1080, channels: 3, background: '#D04F32' } }).png().toFile(fixture);
const raster=await sharp(fixture).raw().toBuffer({resolveWithObject:true}),colors=new Map();
for(let i=0;i<raster.data.length;i+=raster.info.channels){if(raster.info.channels===4&&raster.data[i+3]<250)continue;const color=`${raster.data[i]},${raster.data[i+1]},${raster.data[i+2]}`;colors.set(color,(colors.get(color)??0)+1);}
const mediaColor=[...colors].sort((a,b)=>b[1]-a[1])[0][0].split(',').map(Number);
const browser = await puppeteer.launch({ executablePath: '/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'] });
const page = await browser.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (passed, name, detail) => { checks.push({ name, passed: !!passed, detail }); };

// Read the existing project provider; no application test globals are needed.
function projectStore() {
 const node = document.querySelector('.timeline-scroll');
 let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber$'))];
 while (fiber && !fiber.memoizedProps?.store?.getState?.().timeline) fiber = fiber.return;
 if (!fiber) throw new Error('Project provider was not found');
 return fiber.memoizedProps.store;
}
async function activateHandles() {
 await page.waitForSelector('.preview-hit-surface'); await page.focus('.preview-hit-surface'); await page.keyboard.press('Enter');
 await page.waitForSelector('.visual-selection-box');
 // Keyboard focus would thicken the selection stroke; measure the idle 1px outline.
 await page.evaluate(() => document.activeElement?.blur());
}
async function installCase({ ratio = 'vertical', fit = 'cover', crop, transform = { x: .5, y: .5, scale: 1, rotation: 0, opacity: 1 } }) {
 await page.evaluate(({ functionText, ratio, fit, crop, transform }) => {
  const store = eval(`(${functionText})`)(), timeline = store.getState().timeline, clip = timeline.clips[0];
  store.getState().replace({ ...timeline, aspectRatio: ratio, clips: [{ ...clip, start: 0, duration: 4, fit, crop, transform }], tracks: { visual: 1, overlay: 0, audio: 0 } });
  store.setState({ selectedId: clip.id, selectedIds: [clip.id], playhead: 0 });
 }, { functionText: projectStore.toString(), ratio, fit, crop, transform });
 await page.waitForFunction(({ratio,transform}) => {
  const p=[...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1'),c=p?.iframeElement?.contentDocument?.getElementById('composition'),frame=c?.querySelector('[data-visual-clip]');
  const expected={vertical:[1080,1920],square:[1080,1080],landscape:[1920,1080]};
  return document.querySelectorAll('hyperframes-player').length===1&&p?.ready&&c&&frame&&Number(c.dataset.width)===expected[ratio][0]&&Number(c.dataset.height)===expected[ratio][1]&&Math.abs(parseFloat(frame.style.left)-(transform.x-.5)*expected[ratio][0])<.001&&Math.abs(parseFloat(frame.style.top)-(transform.y-.5)*expected[ratio][1])<.001&&frame.style.transform.includes(`rotate(${transform.rotation}deg)`)&&frame.style.transform.includes(`scale(${transform.scale})`);
 }, {}, {ratio,transform});
 await wait(100);
}
async function metrics() {
 return page.evaluate(() => {
  const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
  const canvas = document.querySelector('.preview-canvas'), stage = document.querySelector('.stage-center'), selection = document.querySelector('.visual-selection-box'), workspace = document.querySelector('.preview-workspace'), player = document.querySelector('hyperframes-player');
  const host = document.querySelector('.hyperframes-host').getBoundingClientRect(), iframe = player.iframeElement.getBoundingClientRect(), composition = player.iframeElement.contentDocument.getElementById('composition').getBoundingClientRect(), window = player.iframeElement.contentDocument.querySelector('.source-window').getBoundingClientRect();
  const source = { x: host.x + (window.x - composition.x) / composition.width * host.width, y: host.y + (window.y - composition.y) / composition.height * host.height, width: window.width / composition.width * host.width, height: window.height / composition.height * host.height };
  const corners = [...document.querySelectorAll('.visual-resize-layer .visual-corner')].map(button => { const r = button.getBoundingClientRect(); return { name: button.getAttribute('aria-label'), ...rect(button), hit: document.elementFromPoint(r.x + 2, r.y + 2)?.closest('button') === button }; });
  const controls = [...document.querySelectorAll('.preview-playback button')].map(button => { const r = button.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === button; });
  return { renderedCanvas: {x:iframe.x,y:iframe.y,width:iframe.width,height:iframe.height,right:iframe.right,bottom:iframe.bottom}, host: {x:host.x,y:host.y,width:host.width,height:host.height,right:host.right,bottom:host.bottom}, canvas: rect(canvas), stage: rect(stage), selection: selection && rect(selection), source, workspace: { height: workspace.clientHeight, scrollHeight: workspace.scrollHeight, width: workspace.clientWidth, scrollWidth: workspace.scrollWidth }, corners, controls };
 });
}
// The 1px selection stroke and anti-aliasing obscure each painted edge. Compare
// each edge, rather than summing both edge losses into a width/height error.
// The original code screenshot's gray pixels retain blue/green chroma (22/25/29,
// 33/35/40,55/57/61); the player letterbox is neutral26/26/26. Classify that
// measured source family instead of counting the player's border as media.
// Rounded canvas corners can contribute isolated antialiased pixels in that
// family. Require a dense 5×5 source neighborhood; the observed corner artifacts
// have at most five neighbors, while the opaque source has ten or more at edges.
async function paintedMediaBounds(value) {
 const stage=generatedFixture?value.stage:value.renderedCanvas;
 const shot=await page.screenshot(), {data,info}=await sharp(shot).raw().toBuffer({resolveWithObject:true});
 const mask=new Uint8Array(info.width*info.height);
 for(let y=Math.max(0,Math.ceil(stage.y));y<Math.min(info.height,Math.floor(stage.bottom));y++)for(let x=Math.max(0,Math.ceil(stage.x));x<Math.min(info.width,Math.floor(stage.right));x++){
  const i=(y*info.width+x)*info.channels;
  const r=data[i],g=data[i+1],b=data[i+2];
  const sourcePixel=generatedFixture?Math.abs(r-mediaColor[0])<10&&Math.abs(g-mediaColor[1])<10&&Math.abs(b-mediaColor[2])<10:r>=mediaColor[0]-6&&g-r>=0&&g-r<=5&&b-g>=2&&b-g<=6;
  if(sourcePixel)mask[y*info.width+x]=1;
 }
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
 for(let y=Math.max(0,Math.ceil(stage.y));y<Math.min(info.height,Math.floor(stage.bottom));y++)for(let x=Math.max(0,Math.ceil(stage.x));x<Math.min(info.width,Math.floor(stage.right));x++){
  if(!mask[y*info.width+x])continue;
  let neighbors=0;
  for(let ny=Math.max(0,y-2);ny<=Math.min(info.height-1,y+2);ny++)for(let nx=Math.max(0,x-2);nx<=Math.min(info.width-1,x+2);nx++)neighbors+=mask[ny*info.width+nx];
  if(neighbors>=10){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}
 }
 return Number.isFinite(left)?{x:left,y:top,width:right-left,height:bottom-top}:null;
}
try {
 await page.setViewport({ width: 1440, height: 900 });
 await page.goto(`${process.env.BASE_URL ?? 'http://localhost:3001'}/dev/editor`, { waitUntil: 'networkidle2' });
 await page.waitForSelector('.timeline-scroll'); await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready);
 // Uploads go through the Add media dialog (81b883d). Its timeline destination is the empty-editor
 // "Choose files" action, so clear the sample timeline before uploading the real fixture.
 await page.evaluate(functionText => { const store = eval(`(${functionText})`)(); store.getState().replace({ ...store.getState().timeline, clips: [] }); store.setState({ selectedId: null, selectedIds: [] }); }, projectStore.toString());
 await page.locator('::-p-aria([name="Choose files"][role="button"])').click();
 await (await page.waitForSelector('input[type=file][aria-label="Choose media to upload"]')).uploadFile(fixture);
 await page.waitForFunction(() => { const node = document.querySelector('.timeline-scroll'); let f = node[Object.keys(node).find(k => k.startsWith('__reactFiber$'))]; while(f && !f.memoizedProps?.store) f=f.return; return f?.memoizedProps.store.getState().timeline.clips.at(-1)?.assetId && !f.memoizedProps.store.getState().timeline.clips.at(-1)?.id.startsWith('shot-'); });
 await page.evaluate(functionText => { const store = eval(`(${functionText})`)(), t = store.getState().timeline, c = t.clips.at(-1); store.getState().replace({ ...t, clips: [{ ...c, start: 0, duration: 4, track: 1 }], tracks: { visual: 1, overlay: 0, audio: 0 } }); store.setState({ selectedId: c.id, selectedIds: [c.id], playhead: 0 }); }, projectStore.toString());
 // Transform handles need explicit activation (81b883d). Keyboard activation targets the canvas center, which the
 // full-frame upload covers, without the double-click that also opens Clip settings (ab82c81). Later cases keep the
 // same selected clip, so the handles stay active.
 await activateHandles();
 await page.waitForFunction(functionText=>{const store=eval(`(${functionText})`)(),p=[...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1'),frame=p?.iframeElement?.contentDocument?.querySelector('[data-visual-clip]');return document.querySelectorAll('hyperframes-player').length===1&&p?.ready&&frame?.dataset.visualClip===store.getState().selectedId;},{},projectStore.toString());
 const expectedMetadata=await sharp(fixture).metadata();
 const importedMetadata=await page.evaluate(()=>{const image=document.querySelector('hyperframes-player').iframeElement.contentDocument.querySelector('.visual');return{width:image.naturalWidth,height:image.naturalHeight};});
 check(importedMetadata.width===expectedMetadata.width&&importedMetadata.height===expectedMetadata.height,'Actual upload retains source dimensions', {expected:{width:expectedMetadata.width,height:expectedMetadata.height},imported:importedMetadata});

 const cases = [
  { name: 'Default Fill', ratio: 'vertical' },
  { name: 'Corner-enlarged Fill', ratio: 'vertical', transform: { x: .9, y: .9, scale: 1.8, rotation: 0, opacity: 1 } },
  { name: 'Moved Fill', ratio: 'vertical', transform: { x: .2, y: .7, scale: .7, rotation: 0, opacity: 1 } },
  { name: 'Retained Fit', ratio: 'vertical', fit: 'contain', transform: { x: .35, y: .45, scale: .6, rotation: 0, opacity: 1 } },
  { name: 'Rotated Fill', ratio: 'vertical', transform: { x: .9, y: .9, scale: 2, rotation: 35, opacity: 1 } },
  { name: 'Cropped Fit', ratio: 'vertical', fit: 'contain', crop: { left: .15, right: .15, top: .05, bottom: .05 }, transform: { x: .8, y: .8, scale: 2.2, rotation: -25, opacity: 1 } },
  { name: 'Square composition', ratio: 'square', transform: { x: .9, y: .9, scale: 1.8, rotation: 0, opacity: 1 } },
  { name: 'Landscape composition', ratio: 'landscape', transform: { x: .9, y: .9, scale: 1.8, rotation: 0, opacity: 1 } },
 ];
 for (const viewport of (process.env.NARROW==='1'?[{width:Number(process.env.NARROW_WIDTH??1440),height:Number(process.env.NARROW_HEIGHT??900)}]:[{ width: 1440, height: 900 }, { width: 1366, height: 740 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }])) {
  await page.setViewport(viewport); await wait(100);
  // The compact layout shows one pane at a time; Agentic shows the conversation, Tracks shows the preview (57c304e).
  if (viewport.width < 768 && await page.$('#editor-tracks-tab[aria-selected="false"]')) { await page.click('#editor-tracks-tab'); await page.waitForSelector('#editor-tracks-tab[aria-selected="true"]'); await wait(150); if (!await page.$('.visual-selection-box')) await activateHandles(); }
  for (const scenario of cases) {
   await installCase(scenario); const value = await metrics(), prefix = `${viewport.width}×${viewport.height} ${scenario.name}`;
   const s = value.selection, stage = value.stage;
   check(value.workspace.scrollHeight <= value.workspace.height + 1 && value.workspace.scrollWidth <= value.workspace.width + 1, `${prefix}: no preview workspace scrollbar`, value.workspace);
   check(s.x >= stage.x + 15 && s.y >= stage.y + 15 && s.right <= stage.right - 15 && s.bottom <= stage.bottom - 15, `${prefix}: complete selected bounds fit above transport`, { selection: s, stage });
   check(value.corners.length === 4 && value.corners.every(c => Math.abs(c.width-24)<.01 && Math.abs(c.height-24)<.01 && c.hit), `${prefix}: all four outside resize targets remain usable`, value.corners);
   check(value.controls.every(Boolean), `${prefix}: selection does not intercept playback controls`);
   const painted = await paintedMediaBounds(value);
   if(process.env.NARROW==='1'&&scenario.name==='Retained Fit')await page.screenshot({path:'/tmp/revline-preview-fit-original-debug.png'});
   check(painted && Math.abs(s.x-painted.x)<=2.5&&Math.abs(s.y-painted.y)<=2.5&&Math.abs(s.right-painted.x-painted.width)<=2.5&&Math.abs(s.bottom-painted.y-painted.height)<=2.5, `${prefix}: selection matches visible painted media after composition masking`, {selection:s,painted});
  }
 }
 await page.setViewport({ width: 1440, height: 900 }); await installCase(cases[1]); const before = await metrics();
 const beforeEdit = await page.evaluate(functionText => { const state=eval(`(${functionText})`)().getState(); return { transform: state.timeline.clips[0].transform, history: state.history.length }; }, projectStore.toString());
 const corner = before.corners.find(c => c.name === 'Resize bottom right');
 await page.mouse.move(corner.x + 12, corner.y + 12); await page.mouse.down(); await page.mouse.move(corner.x + 32, corner.y + 32, { steps: 5 }); const during = await metrics();
 check(Math.abs(during.source.x-before.source.x)<.6&&Math.abs(during.source.y-before.source.y)<.6,'Clipped-media corner resize preserves the canonical opposite anchor',{before:before.source,during:during.source});
 check(Math.abs(during.canvas.width - before.canvas.width) < .1 && Math.abs(during.canvas.height - before.canvas.height) < .1, 'Preview scale remains frozen throughout a real corner drag', { before: before.canvas, during: during.canvas });
 await page.mouse.up(); await wait(400); const after = await metrics();
 const afterEdit = await page.evaluate(functionText => { const state=eval(`(${functionText})`)().getState(); return { transform: state.timeline.clips[0].transform, history: state.history.length }; }, projectStore.toString());
 check(afterEdit.transform.scale > beforeEdit.transform.scale && afterEdit.history === beforeEdit.history + 1, 'The usable outside corner commits one real resize edit', { before: beforeEdit, after: afterEdit });
 check(after.selection.bottom <= after.stage.bottom - 15 && after.workspace.scrollHeight <= after.workspace.height + 1 && Math.abs(after.canvas.width-before.canvas.width)<.1, 'Committed resize preserves the composition viewport with no scrollbar', after);
 await page.screenshot({ path: generatedFixture?'/tmp/revline-preview-visible-bounds-after.png':'/tmp/revline-preview-original-screenshot-after.png' });
 await page.click('[aria-label="Undo"]'); await wait(300);
 const undone=await page.evaluate(functionText=>{const state=eval(`(${functionText})`)().getState();return{transform:state.timeline.clips[0].transform,history:state.history.length};},projectStore.toString());
 check(JSON.stringify(undone.transform)===JSON.stringify(beforeEdit.transform)&&undone.history===beforeEdit.history,'Undo restores the imported media transform exactly',undone);
 const parked=await metrics(), cancelCorner=parked.corners.find(c=>c.name==='Resize bottom right');
 await page.mouse.move(cancelCorner.x+12,cancelCorner.y+12);await page.mouse.down();await page.mouse.move(cancelCorner.x+30,cancelCorner.y+25,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await wait(100);
 const canceled=await page.evaluate(functionText=>{const state=eval(`(${functionText})`)().getState();return{transform:state.timeline.clips[0].transform,history:state.history.length};},projectStore.toString());
 check(JSON.stringify(canceled)===JSON.stringify(undone),'Escape cancels a real clipped-media resize without a history entry',canceled);
 const cancelPaint=await metrics();
 check(Math.abs(cancelPaint.source.width-parked.source.width)<.6&&Math.abs(cancelPaint.source.height-parked.source.height)<.6,'Escape restores the actually rendered media geometry');
 await page.goto(process.env.BASE_URL ?? 'http://localhost:3001', { waitUntil: 'networkidle2' });
 await page.waitForSelector('.landing-product-demo .preview-viewport');
 await page.waitForFunction(() => {
  const frame = document.querySelector('.landing-product-demo .preview-viewport-frame');
  return frame && frame.clientWidth > 0 && frame.clientHeight > 0 && getComputedStyle(frame).visibility === 'visible';
 });
 const landingPreview = await page.$eval('.landing-product-demo .preview-viewport', viewport => {
  const bounds = viewport.getBoundingClientRect(), frame = viewport.querySelector('.preview-viewport-frame').getBoundingClientRect();
  return { height: viewport.clientHeight, scrollHeight: viewport.scrollHeight, width: viewport.clientWidth, scrollWidth: viewport.scrollWidth, frameFits: frame.left >= bounds.left - 1 && frame.top >= bounds.top - 1 && frame.right <= bounds.right + 1 && frame.bottom <= bounds.bottom + 1 };
 });
 check(landingPreview.frameFits && landingPreview.scrollHeight <= landingPreview.height + 1 && landingPreview.scrollWidth <= landingPreview.width + 1, 'Landing live editor keeps its fitted preview inside a bounded viewport', landingPreview);
 check(errors.length === 0, 'No runtime errors', errors);
 console.log(JSON.stringify({ checks: checks.length, failed: checks.filter(c => !c.passed) }, null, 2));
 assert.ok(checks.every(c => c.passed), 'Preview viewport checks failed');
} finally { await browser.close(); if(generatedFixture) await fs.rm(fixture, { force: true }); }
