import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import {startFixtureFontServer} from './ui-fixture-fonts.mjs';

// The actual inspector and text controls; only synthetic text is changed.
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {PreviewInspector} from './components/editor/preview-inspector';
import {addTextClip,patchClip} from './lib/editor/operations';
import {textLookPatch} from './lib/editor/text-looks';
import './components/workspace/workspace-pages.css';import './app/editor.css';
const initial={fps:30,aspectRatio:'vertical',clips:[],tracks:{visual:1,overlay:0,audio:1,effects:0}};
function Fixture(){const[timeline,setTimeline]=useState(initial),[selected,setSelected]=useState(),[editRequest,setEditRequest]=useState(0);const clip=timeline.clips.find(item=>item.id===selected);
window.fixture={timeline,clip,setClip:patch=>setTimeline(previous=>patchClip(previous,selected,patch))};
function addLook(look){const id='text-'+(++window.ids);let next=addTextClip(timeline,id,'graphic',1);next=patchClip(next,id,textLookPatch(next.clips.find(item=>item.id===id),look));window.pendingLook=look;setTimeline(next);setSelected(id);setEditRequest(value=>value+1)}
return <PreviewInspector clip={clip} assets={[]} upload={null} editRequest={editRequest} onUpload={()=>{}} onAdd={()=>{}} onCrop={()=>{}} onAddTextLook={addLook} onPreviewEffects={patch=>window.previews.push(patch)} onChange={patch=>{window.patches.push(patch);setTimeline(previous=>patchClip(previous,selected,patch))}}/>}
window.ids=0;window.patches=[];window.previews=[];createRoot(document.getElementById('root')).render(<Fixture/>);
` }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-text-look-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const fonts=await startFixtureFontServer();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage(); page.setDefaultTimeout(8000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const button=name=>page.locator('::-p-aria([name="'+name+'"][role="button"])');
try {
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);
  await page.setViewport({width:540,height:900});
  await page.goto(fonts.url);
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root" class="conversation-editor"></div></body></html>');
  await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
  await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;background:var(--ws-bg);font:12px Arial}button{border:0;font-family:inherit}#root{width:480px;height:860px;margin:20px auto}'});
  await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
  await page.click('[data-segment="text"]');
  await page.waitForSelector('[aria-label="Default text"]');
  assert.equal(await page.$('[aria-label="Text animations"]'),null,'Text library offers looks before any text exists');
  assert.ok(await page.$('[aria-label="Default text"]'),'A plain Default text option must be available');
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('Subtitle styles')),false,'Text is not split into subtitle styles');
  await button('Default text').click();await page.waitForSelector('[aria-label="Selected text"]');await page.waitForSelector('[aria-label="Text animations"]');
  assert.equal(await page.evaluate(()=>window.fixture.clip.textTemplate),undefined);
  assert.equal(await page.evaluate(()=>window.fixture.clip.animation),'none');
  const entities=await page.evaluate(()=>({ids:window.fixture.timeline.clips.map(clip=>clip.id),tracks:window.fixture.timeline.tracks}));
  const custom={text:'Keep my exact words',color:'#12ab67',fontFamily:'dm-serif',fontSize:83,background:'#19273d',blendMode:'screen',x:.3,y:.7,transform:{x:0,y:0,scale:1,rotation:12},textStyle:{strokeWidth:3,strokeColor:'#e75425',shadowBlur:12,shadowX:4,shadowY:8,shadowColor:'#333333',glowBlur:18,glowColor:'#35b6eb'}};
  await page.evaluate(custom=>window.fixture.setClip(custom),custom);await flush();
  await button('Apply Word reveal').click();await flush();
  assert.equal(await page.evaluate(()=>window.fixture.clip.textTemplate.preset),'word-reveal');
  for(const key of Object.keys(custom)) assert.deepEqual(await page.evaluate(key=>window.fixture.clip[key],key),custom[key],'Animation preserves '+key);
  await button('Apply Pop in').click();await flush();
  assert.equal(await page.evaluate(()=>window.fixture.clip.textTemplate),undefined,'One selected animation replaces the previous one');
  assert.ok(await page.evaluate(()=>window.fixture.clip.motion.length>0));
  for(const key of Object.keys(custom)) assert.deepEqual(await page.evaluate(key=>window.fixture.clip[key],key),custom[key]);
  await button('Apply Neon echo').click();await flush();
  assert.equal(await page.evaluate(()=>window.fixture.clip.textTemplate.preset),'neon-echo');assert.deepEqual(await page.evaluate(()=>({ids:window.fixture.timeline.clips.map(clip=>clip.id),tracks:window.fixture.timeline.tracks})),entities,'Animations apply to the selected text without creating a clip or track');
  for(const key of Object.keys(custom)) assert.deepEqual(await page.evaluate(key=>window.fixture.clip[key],key),custom[key],'Neon animation preserves '+key);
  assert.equal(await page.$$eval('.text-preset-stage,.text-look-stage',nodes=>nodes.some(node=>getComputedStyle(node).backgroundImage!=='none')),false,'Card stages use solid backgrounds');
  await page.focus('[aria-label="Preview Word reveal"]');
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Word reveal"] [data-frame]').dataset.frame)<44);
  const commits=await page.evaluate(()=>window.patches.length);await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement.blur());
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.hover('[aria-label="Word reveal"]');
  await page.waitForFunction(()=>document.querySelector('[aria-label="Word reveal"] [data-frame]').dataset.frame==='45');
  assert.equal(await page.evaluate(()=>window.patches.length),commits,'Preview never writes text');
  assert.equal(await page.$eval('[aria-label="Text font"]',node=>node.tagName),'BUTTON','Font uses the shared menu trigger');
  const beforeFont=await page.evaluate(()=>({clip:window.fixture.clip,writes:window.patches.length}));
  await page.focus('[aria-label="Text font"]');await page.keyboard.press('Enter');await page.waitForSelector('[role="menuitemradio"][data-value="anton"]');
  assert.equal(await page.$eval('[role="menuitemradio"][data-value="dm-serif"]',node=>node.getAttribute('aria-checked')),'true');assert.ok(await page.$('[role="menuitemradio"][data-value="dm-serif"] svg'),'Selected choice has a check');assert.ok(Math.abs(await page.$eval('[role="menu"]',node=>node.getBoundingClientRect().width)-await page.$eval('[aria-label="Text font"]',node=>node.getBoundingClientRect().width))<2,'Menu matches the trigger width');
  assert.ok(await page.$eval('[role="menuitemradio"][data-value="anton"] .inspector-select-value',node=>getComputedStyle(node).fontFamily.includes('Anton')),'Each font row previews its own font');
  assert.equal(await page.evaluate(()=>window.patches.length),beforeFont.writes,'Opening the menu does not save');
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/tmp/revline-text-font-menu-dark.png'});await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='light');await page.screenshot({path:'/tmp/revline-text-font-menu-light.png'});await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='dark');
  await page.keyboard.press('Home');await flush();await page.keyboard.press('ArrowDown');await flush();await page.keyboard.press('Enter');await flush();assert.equal(await page.evaluate(()=>window.fixture.clip.fontFamily),'anton');assert.equal(await page.evaluate(()=>window.patches.length),beforeFont.writes+1);
  for(const key of Object.keys(beforeFont.clip).filter(key=>key!=='fontFamily'))assert.deepEqual(await page.evaluate(key=>window.fixture.clip[key],key),beforeFont.clip[key],'Font choice preserves '+key);
  await page.click('[aria-label="Text font"]');await page.keyboard.press('Escape');await flush();assert.equal(await page.evaluate(()=>window.patches.length),beforeFont.writes+1,'Canceling a menu does not edit');
  await page.$eval('.text-style-group:last-child',node=>node.open=true);await page.click('[aria-label="Text blend mode"]');await page.waitForSelector('[role="menuitemradio"][data-value="multiply"]');await page.click('[role="menuitemradio"][data-value="multiply"]');await flush();assert.equal(await page.evaluate(()=>window.fixture.clip.blendMode),'multiply');
  assert.equal(await page.$$eval('.text-editing-controls select,.text-style-controls select',nodes=>nodes.length),0,'Text settings do not expose raw native selects');

  await page.click('.text-style-group summary');await page.focus('[aria-label="Stroke width"]');await page.keyboard.press('ArrowRight');await page.keyboard.press('Tab');await flush();assert.equal(await page.evaluate(()=>window.fixture.clip.textStyle.strokeWidth),4);assert.ok(await page.evaluate(()=>window.previews.some(patch=>patch?.textStyle?.strokeWidth===4)),'Style drafts reach the preview');
  const range=await page.$eval('[aria-label="Stroke width"]',node=>{const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width,height:rect.height}});const beforeDrag=await page.evaluate(()=>window.patches.length);await page.mouse.move(range.x+range.width*.2,range.y+range.height/2);await page.mouse.down();await page.mouse.move(range.x+range.width*.6,range.y+range.height/2,{steps:4});await flush();assert.equal(await page.evaluate(()=>window.patches.length),beforeDrag,'Dragging does not save per frame');assert.equal(await page.evaluate(()=>window.fixture.clip.textStyle.strokeWidth),4);assert.ok(await page.evaluate(()=>window.previews.at(-1).textStyle.strokeWidth>4));await page.mouse.up();await flush();assert.equal(await page.evaluate(()=>window.patches.length),beforeDrag+1,'Release saves one style change');
  const afterDrag=await page.evaluate(()=>window.fixture.clip.textStyle.strokeWidth);await page.mouse.down();await page.mouse.move(range.x+range.width*.8,range.y+range.height/2,{steps:3});await flush();await page.keyboard.press('Escape');await page.mouse.up();await flush();assert.equal(await page.evaluate(()=>window.fixture.clip.textStyle.strokeWidth),afterDrag);assert.equal(await page.evaluate(()=>window.previews.at(-1)),null,'Escape clears the preview draft');
  assert.ok(await page.$('[aria-label="Stroke width"]'));assert.ok(await page.$('[aria-label="Glow blur"]'));assert.ok(await page.$('[aria-label="Shadow blur"]'));
  await page.evaluate(()=>document.fonts.ready);await page.$eval('#inspector-edit',node=>node.scrollTop=0);await flush();await page.screenshot({path:'/tmp/revline-text-editable-style-dark.png'});
  await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='light');await page.screenshot({path:'/tmp/revline-text-editable-style-light.png'});
  await page.setViewport({width:320,height:900});await page.addStyleTag({content:'#root{width:320px;margin:0;height:900px}'});
  assert.ok(await page.$eval('.preview-inspector',node=>node.scrollWidth<=node.clientWidth),'Text controls fit 320px');
  await page.click('#inspector-sources-tab');await page.click('[data-segment="text"]');await page.waitForSelector('[aria-label="Default text"]');assert.equal(await page.$('[aria-label="Text animations"]'),null,'Library stays looks-only with selected text');
  assert.deepEqual(errors,[]);
  console.log('PASS: Default text, unified looks, independent animations preserve all appearance and words, real frame previews, reduced motion, no gradient stages, editable stroke/shadow/glow, and 320px fit.');
} finally {await browser.close();await fonts.close();}
