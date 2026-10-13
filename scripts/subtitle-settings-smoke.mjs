import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

// Real Shell, Timeline, Inspector and TextControls; only account/chat/media-player boundaries mocked.
const video=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=orange:s=16x16:r=10','-t','0.3','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
const assets=[{_id:'overlay-image',fileName:'Light leak.png',kind:'image',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='},{_id:'overlay-video',fileName:'Glow.mp4',kind:'video',duration:.3,url:'data:video/mp4;base64,'+video.toString('base64')}];
const stubs = {
  'next/navigation': `export const useSearchParams=()=>new URLSearchParams();`,
  '@/components/workspace/workspace-nav': `export const WorkspaceNav=()=>null;`,
  './assistant-panel': `export const AssistantPanel=()=>null;`,
  './export-dialog': `export const ExportDialog=()=>null;`,
  './media-import-dialog': `export const MediaImportDialog=()=>null;`,
  './preview': `import React,{forwardRef,useState,useImperativeHandle} from 'react';import {TextControls} from './components/editor/text-controls';
  export const Preview=forwardRef(function Preview(p,ref){const[active,setActive]=useState();useImperativeHandle(ref,()=>({currentTime:()=>1,seek:()=>{},pause:()=>{},play:()=>{},mute:()=>{},clipVolume:()=>{}}),[]);return <div className="fixture-preview" style={{position:'relative',width:'100%',height:200}}><div id="composition" style={{position:'absolute',inset:0}}>{p.timeline.clips.map((clip,index)=>['graphic','caption'].includes(clip.kind)?<div key={clip.id} id={'clip-'+index} style={{position:'absolute',left:'50%',top:clip.kind==='caption'?'70%':'35%',transform:'translate(-50%,-50%)',fontSize:24,width:'max-content'}}>{clip.text}</div>:null)}</div><TextControls timeline={p.timeline} assets={p.assets} time={1} revision={0} selected={p.selectedClip?.id} activeId={active} onActivate={setActive} getDocument={()=>document} onSelect={p.onSelectClip} onEdit={p.onEditText} onCommit={p.onClipChange}/></div>});`,
};
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
import {TooltipProvider} from './components/ui/tooltip';import {EditorShell} from './components/editor/editor-shell';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';
import './components/workspace/workspace-pages.css';import './app/editor.css';
let ids=0;Object.defineProperty(crypto,'randomUUID',{value:()=>\`fixture-new-\${++ids}\`});
const assets=${JSON.stringify(assets)};
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:0,effects:0},clips:[{id:'caption',kind:'caption',text:'Keep these words',start:0,duration:4,sourceStart:0,track:1,x:.5,y:.82,color:'#ffffff',fontSize:52,background:'transparent',transform:{x:.5,y:.5,scale:1,rotation:12,opacity:1},textTemplate:{preset:'word-reveal'},animation:'fade'},{id:'title',kind:'graphic',text:'Actual title',start:0,duration:4,sourceStart:0,track:2},{id:'footage',kind:'image',assetId:'fake',start:8,duration:3,sourceStart:0,track:1}]};
const store=createEditorStore(initial);store.setState({playhead:1});window.fixture={store};window.commits=0;window.errors=[];
function Fixture(){const timeline=useStore(store,state=>state.timeline);return <TooltipProvider><EditorStateProvider store={store}><EditorShell workspaceOnly title="Synthetic text settings" timeline={timeline} assets={assets} onChange={next=>{window.commits++;store.getState().edit(next)}} onTitle={()=>{}} onUpload={async()=>{}} onDropUpload={async()=>{}} saving={false} upload={null} error="" onError={message=>{if(message)window.errors.push(message)}} onUndo={()=>store.getState().undo()} onRedo={()=>{}} canUndo={false} canRedo={false} messages={[]} aiRunning={false} aiConfigured={false} onSend={async()=>{}} onExport={async()=>{}} exportState={null} demo/></EditorStateProvider></TooltipProvider>}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, plugins: [{ name: 'isolated-boundaries', setup(builder) {
  builder.onResolve({ filter: /.*/ }, args => Object.hasOwn(stubs, args.path) ? { path: args.path, namespace: 'fixture' } : undefined);
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: process.cwd() }));
} }], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false, outdir: '/tmp/revline-subtitle-fixture', define: { 'process.env.NODE_ENV': '"production"' } });
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
const page = await browser.newPage();page.setDefaultTimeout(8000); const errors = [];page.on('pageerror', error => errors.push(error.message));
const flush = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const library = async () => { if (!await page.$('.effect-library')) await page.click('#inspector-sources-tab');await flush(); };
const caption = () => page.evaluate(() => window.fixture.store.getState().timeline.clips.find(clip => clip.id === 'caption'));
try {
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setContent('<html data-workspace-theme="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;font-family:Arial;background:var(--ws-bg)}.editor-app{height:900px}.fixture-preview{pointer-events:auto}.text-controls{position:absolute;inset:0}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector('.effect-library');
  assert.ok(await page.$eval('.preview-inspector', element=>element.getBoundingClientRect().width>=370),'Sources panel is wider by default');
  assert.equal(await page.$('[placeholder="Find a look"]'),null,'No look search field');
  await page.click('[aria-label="Move text: Keep these words"]');await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'Keep these words', 'Single preview click opens the actual words');
  for (const label of ['Text color', 'Text size', 'Custom text size']) assert.ok(await page.$(`[aria-label="${label}"]`), `Full settings contain ${label}`);
  assert.equal(await page.$('.quick-text-dialog'), null, 'No words-only modal');
  assert.ok(await page.$('[aria-label="Rotate text in preview"]'),'Rotation is on the preview');
  assert.equal(await page.$('[aria-label="Text rotation"]'),null,'Rotation numeric control is removed');
  await page.waitForSelector('.text-preset-card');
  assert.equal(await page.$$eval('.subtitle-style-card', cards => cards.length), 4, 'Caption settings offer all four subtitle styles');
  const original = await caption();
  for (const [label, expected] of [['Clean', {color:'#FFFFFF',background:'transparent',fontSize:52}],['Bold',{color:'#F5CF45',background:'transparent',fontSize:64}],['Boxed',{color:'#FFFFFF',background:'#0B0C0EE6',fontSize:52}],['Highlight',{color:'#0B0C0E',background:'#F5CF45',fontSize:52}]]) {
    const before = await page.evaluate(() => window.commits);
    await page.click(`[aria-label="${label} subtitles"]`);await flush();const current = await caption();
    assert.deepEqual({color:current.color,background:current.background,fontSize:current.fontSize}, expected);
    assert.deepEqual({...current,color:original.color,background:original.background,fontSize:original.fontSize},original,'Style preserves words, timing, motion, template, position and rotation');
    assert.equal(await page.evaluate(() => window.commits), before + 1, 'A style click edits once');
  }
  await library();await page.click('.timeline-clip[data-clip-id="caption"]');await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'Keep these words', 'Clicking an already-selected timeline caption reopens full settings');
  await library();await page.click('.timeline-clip[data-clip-id="title"]');await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'Actual title', 'Timeline graphic single click opens its own settings');
  await library();await page.click('.timeline-clip[data-clip-id="footage"]');await flush();assert.ok(await page.$('.effect-library'), 'Footage selection does not force the text editor');
  await page.click('[data-library-tab="text"]');await page.waitForSelector('[aria-label="Boxed subtitles"]');
  assert.equal(await page.$eval('.effect-library', element=>element.textContent.includes('Add ready-to-edit text')),false,'No redundant playhead note');
  await page.click('[aria-label="Boxed subtitles"]');await page.waitForSelector('[aria-label="Selected text"]');
  const created = await page.evaluate(() => {const state=window.fixture.store.getState();return state.timeline.clips.find(clip=>clip.id===state.selectedId)});
  assert.equal(created.kind,'caption');assert.equal(created.start,1);assert.equal(created.background,'#0B0C0EE6','No caption selected creates styled subtitle at playhead');
  await page.screenshot({ path: '/tmp/revline-subtitle-settings-dark.png' });
  await library();await page.click('[data-library-tab="overlays"]');
  await page.waitForFunction(()=>document.querySelector('.library-overlay-thumbnail img')?.naturalWidth>0);
  await page.waitForFunction(()=>document.querySelector('.library-overlay-thumbnail video')?.readyState>=2);
  assert.equal(await page.$eval('.library-overlay-thumbnail video',element=>element.muted && element.preload==='metadata' && !element.autoplay),true,'Overlay video stays a muted static preview');
  assert.ok(await page.$eval('.library-overlay-look', element=>element.getBoundingClientRect().height<=46),'Overlay previews stay compact');
  await page.click('.library-overlay-look');await flush();
  assert.equal(await page.evaluate(()=>window.fixture.store.getState().timeline.clips.at(-1).assetId),'overlay-image','Thumbnail row applies the actual overlay');
  await page.screenshot({path:'/tmp/revline-overlay-library-dark.png'});
  // Latest Sources action must win even after earlier text requests, and a later selection reverses it.
  await page.evaluate(() => {const dt=new DataTransfer();dt.items.add(new File(['data'],'image.png',{type:'image/png'}));document.querySelector('.editor-app').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}))});
  await page.waitForSelector('[aria-label="Search sources"]');
  await page.click('.timeline-clip[data-clip-id="caption"]');await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'Keep these words', 'Later text click wins over previous Sources request');
  await page.evaluate(() => {document.documentElement.dataset.workspaceTheme='light'});await page.screenshot({path:'/tmp/revline-subtitle-settings-light.png'});
  await page.setViewport({width:800,height:900});await page.waitForFunction(()=>!document.querySelector('.preview-inspector'));
  await page.click('.timeline-clip[data-clip-id="caption"]');await page.waitForSelector('.preview-inspector-sheet [aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]',element=>element.value),'Keep these words','Narrow editor opens its existing sheet for a text click');
  assert.deepEqual(await page.evaluate(() => window.errors), []);assert.deepEqual(errors, []);
  console.log('PASS: real Shell/Timeline/TextControls single selection, full text settings, four subtitle styles, preserved caption properties, one apply, new playhead caption, video selection, Sources request ordering, compact actual overlay thumbnails and narrow sheet. Synthetic fixture.');
} catch (error) { console.error(JSON.stringify({errors,appErrors:await page.evaluate(()=>window.errors),dom:await page.evaluate(()=>document.body.innerText.slice(0,1000))})); throw error; } finally { await browser.close(); }
