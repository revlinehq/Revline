import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';

// Real Shell, Timeline, Inspector and TextControls; only account/chat/media-player boundaries mocked.
const video=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=orange:s=16x16:r=10','-t','0.3','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1']);
const assets=[{_id:'overlay-image',fileName:'Light leak.png',kind:'image',url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='},{_id:'overlay-video',fileName:'Glow.mp4',kind:'video',duration:.3,url:'data:video/mp4;base64,'+video.toString('base64')}];
const stubs = {
  'next/navigation': `const params=new URLSearchParams();export const useSearchParams=()=>params;`,
  '@/components/workspace/workspace-nav': `export const WorkspaceNav=()=>null;`,
  './assistant-panel': `export const AssistantPanel=()=>null;`,
  './export-dialog': `export const ExportDialog=()=>null;`,
  './media-import-dialog': `export const MediaImportDialog=()=>null;`,
  './preview': `import React,{forwardRef,useState,useImperativeHandle} from 'react';import {TextControls} from './components/editor/text-controls';
  export const Preview=forwardRef(function Preview(p,ref){const[active,setActive]=useState();useImperativeHandle(ref,()=>({currentTime:()=>1,seek:()=>{},pause:()=>{},play:()=>{},mute:()=>{},clipVolume:()=>{},clipEffects:()=>{}}),[]);return <div className="fixture-preview" style={{position:'relative',width:'100%',height:200}}><div id="composition" style={{position:'absolute',inset:0}}>{p.timeline.clips.map((clip,index)=>['graphic','caption'].includes(clip.kind)?<div key={clip.id} id={'clip-'+index} style={{position:'absolute',left:'50%',top:clip.kind==='caption'?'70%':'35%',transform:'translate(-50%,-50%)',fontSize:24,width:'max-content'}}>{clip.text}</div>:null)}</div><TextControls timeline={p.timeline} assets={p.assets} time={1} revision={0} selected={p.selectedClip?.id} activeId={active} onActivate={setActive} getDocument={()=>document} onSelect={p.onSelectClip} onEdit={p.onEditText} onCommit={p.onClipChange}/></div>});`,
};
const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
import React from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
import {TooltipProvider} from './components/ui/tooltip';import {EditorShell} from './components/editor/editor-shell';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';
import './components/workspace/workspace-pages.css';import './app/editor.css';
let ids=0;Object.defineProperty(crypto,'randomUUID',{value:()=>\`fixture-new-\${++ids}\`});
const assets=${JSON.stringify(assets)};
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:1},clips:[{id:'caption',kind:'caption',text:'Keep these words',start:0,duration:4,sourceStart:0,track:1,x:.5,y:.82,color:'#ffffff',fontSize:52,background:'transparent',transform:{x:.5,y:.5,scale:1,rotation:12,opacity:1},textTemplate:{preset:'word-reveal'},animation:'fade'},{id:'title',kind:'graphic',text:'Actual title',start:0,duration:4,sourceStart:0,track:2},{id:'footage',kind:'image',assetId:'overlay-image',start:8,duration:3,sourceStart:0,track:1},{id:'video',kind:'video',assetId:'overlay-video',start:11,duration:3,sourceStart:0,track:1},{id:'audio',kind:'audio',start:0,duration:14,sourceStart:0,track:1,volume:.7},{id:'effect',kind:'effect',effectPreset:'cinematic-bars',start:5,duration:1,sourceStart:0,track:1}]};
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
  await page.addStyleTag({ content: '*{box-sizing:border-box}body{margin:0;font-family:Arial;background:var(--ws-bg)}.editor-app{height:900px}.fixture-preview{pointer-events:auto}.text-controls{position:absolute;inset:0}button{font-family:inherit}' });
  await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js')).text });
  await page.waitForSelector('.effect-library');
  assert.ok(await page.$eval('.preview-inspector', element=>element.getBoundingClientRect().width>=470));
  await page.click('[aria-label="Move text: Keep these words"]');await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]', element => element.value), 'Keep these words');
  for (const label of ['Text color','Text size','Custom text size','Text font']) assert.ok(await page.$('[aria-label="'+label+'"]'));
  assert.equal(await page.$('.quick-text-dialog'),null);
  assert.ok(await page.$('[aria-label="Rotate text in preview"]'));assert.equal(await page.$('[aria-label="Text rotation"]'),null);
  assert.equal(await page.$('.subtitle-style-card'),null,'Captions use the shared text editor');
  const original=await caption();await page.click('.text-look-settings summary');await page.waitForSelector('.text-look-card[aria-label="Bold"]');
  for(const [label,expected] of [['Bold',{color:'#F5CF45',background:'transparent',fontSize:104}],['Boxed',{color:'#F4F4F0',background:'#0B0C0EE6',fontSize:92}],['Difference',{color:'#FFFFFF',background:'transparent',fontSize:92}],['Highlight',{color:'#151619',background:'#F5CF45',fontSize:92}]]) {
    const commits=await page.evaluate(()=>window.commits);await page.click('.text-look-card[aria-label="'+label+'"]');await flush();const current=await caption();
    assert.deepEqual({color:current.color,background:current.background,fontSize:current.fontSize},expected);
    for(const key of ['text','start','duration','sourceStart','track','animation','textTemplate','x','y','transform']) assert.deepEqual(current[key],original[key],'Look preserves '+key);
    assert.equal(current.blendMode,label==='Difference'?'difference':'normal');assert.equal(await page.evaluate(()=>window.commits),commits+1);
  }
  await library();await page.click('.timeline-clip[data-clip-id="caption"]');await page.waitForSelector('[aria-label="Selected text"]');
  assert.equal(await page.$eval('[aria-label="Selected text"]',node=>node.value),'Keep these words');
  await library();await page.click('.timeline-clip[data-clip-id="title"]');await page.waitForSelector('[aria-label="Selected text"]');assert.equal(await page.$eval('[aria-label="Selected text"]',node=>node.value),'Actual title');
  await library();await page.click('.timeline-clip[data-clip-id="footage"]');await flush();assert.ok(await page.$('.effect-library'));
  await page.click('[data-segment="text"]');await page.waitForSelector('[aria-label="Word reveal"]');
  assert.equal(await page.$eval('[aria-label="Apply Word reveal"]',node=>node.disabled),true);
  await page.click('[aria-label="Default text"]');await page.waitForSelector('[aria-label="Selected text"]');
  const created=await page.evaluate(()=>{const state=window.fixture.store.getState();return state.timeline.clips.find(clip=>clip.id===state.selectedId)});
  assert.equal(created.kind,'graphic');assert.equal(created.start,1);assert.equal(created.animation,'none');assert.equal(created.textTemplate,undefined);assert.equal(created.background,'transparent');
  await page.click('[aria-label="Apply Word reveal"]');await flush();assert.equal(await page.evaluate(()=>window.fixture.store.getState().timeline.clips.find(clip=>clip.id===window.fixture.store.getState().selectedId).textTemplate.preset),'word-reveal');
  await library();await page.click('#inspector-media-tab');await page.waitForSelector('.source-media-row');
  assert.equal(await page.$('.library-media-access'),null);await page.screenshot({path:'/tmp/revline-text-shell-media-dark.png'});
  await page.click('.timeline-clip[data-clip-id="caption"]');await page.waitForSelector('[aria-label="Selected text"]');assert.equal(await page.$eval('[aria-label="Selected text"]',node=>node.value),'Keep these words');
  await page.evaluate(()=>document.documentElement.dataset.workspaceTheme='light');await page.screenshot({path:'/tmp/revline-text-shell-light.png'});
  for(const [id,selector] of [['footage','.footage-settings'],['video','.footage-settings'],['audio','#inspector-edit [aria-label="Clip volume"]'],['effect','[aria-label="Cinematic bars settings"]'],['caption','[aria-label="Selected text"]'],['title','[aria-label="Selected text"]']]) {
    await library();await page.click('.timeline-clip[data-clip-id="'+id+'"]',{count:2,delay:35});await page.waitForSelector(selector);assert.equal(await page.evaluate(()=>window.fixture.store.getState().selectedId),id,'Double click selects and opens '+id+' settings');
  }
  await page.setViewport({width:800,height:900});await page.waitForFunction(()=>!document.querySelector('.preview-inspector'));
  await page.click('.timeline-clip[data-clip-id="caption"]');await page.waitForSelector('.preview-inspector-sheet [aria-label="Selected text"]');assert.equal(await page.$eval('[aria-label="Selected text"]',node=>node.value),'Keep these words');
  assert.deepEqual(await page.evaluate(()=>window.errors),[]);assert.deepEqual(errors,[]);
  console.log('PASS: actual EditorShell/Timeline/TextControls selection, shared caption/title editor, editable look application without words/timing/animation changes, real Default text creation, separate animation application, double-click settings for every clip kind, My media and responsive sheet. Synthetic only.');
} catch(error){console.error(JSON.stringify({errors,appErrors:await page.evaluate(()=>window.errors),dom:await page.evaluate(()=>document.body.innerText.slice(0,1000))}));throw error;}finally{await browser.close();}
