import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

// Real EditorShell, store, panels, preview, timeline and library; synthetic local media only.
const directory = await mkdtemp(join(tmpdir(), 'revline-effect-navigation-'));
const source = join(directory, 'source.mp4');
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','3','-threads','1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',source]);
const stubs = {
  'next/navigation': `const params=new URLSearchParams();export const useSearchParams=()=>params;`,
  '@/components/workspace/workspace-nav': `import React from 'react';export const WorkspaceNav=p=><header className="fixture-nav"><span>revline</span>{p.editorControls}</header>;`,
};
const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
import {EditorShell} from './components/editor/editor-shell';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import {TooltipProvider} from './components/ui/tooltip';
import './components/workspace/shared.css';import './components/workspace/workspace-pages.css';import './app/editor.css';
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0},clips:[{id:'footage',kind:'video',assetId:'source',track:1,start:0,duration:3,sourceStart:0,volume:1}]};
const store=createEditorStore(initial);window.fixture=store;const assets=[{_id:'source',kind:'video',fileName:'Local footage.mp4',url:location.origin+'/source.mp4',width:640,height:360,duration:3,audioExtracted:true}];
function Fixture(){const timeline=useStore(store,s=>s.timeline),history=useStore(store,s=>s.history),future=useStore(store,s=>s.future),[error,setError]=useState('');return <EditorStateProvider store={store}><EditorShell title="Effect navigation proof" onTitle={()=>{}} timeline={timeline} assets={assets} onChange={next=>store.getState().edit(next)} saving={false} upload={null} error={error} onError={setError} onUndo={()=>store.getState().undo()} onRedo={()=>store.getState().redo()} canUndo={!!history.length} canRedo={!!future.length} onUpload={async()=>{}} onDropUpload={async()=>{}} messages={[]} assistantPanel={<div>Local fixture conversation</div>} aiRunning={false} aiConfigured={false} onSend={async()=>{}} onExport={async()=>{}} exportState={null}/></EditorStateProvider>};createRoot(document.getElementById('root')).render(<TooltipProvider><Fixture/></TooltipProvider>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:directory,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'local-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));builder.onLoad({filter:/node_modules\/(?:react|react-dom|scheduler)\/.*\.[cm]?js$/},async({path})=>({contents:(await readFile(path,'utf8')).replaceAll('process.env.NODE_ENV','"development"'),loader:'js'}));}}]});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://local').pathname;let body,mime='text/html';
 if(path==='/fixture.js'){body=js;mime='text/javascript';}
 else if(path==='/source.mp4'){body=await readFile(source);mime='video/mp4';}
 else if(path.startsWith('/vendor/')||path.startsWith('/fonts/')){body=await readFile('public'+path).catch(()=>null);mime=path.endsWith('.js')?'text/javascript':'application/octet-stream';}
 else body='<html data-workspace-theme="dark"><style>'+css+'body{margin:0;font:12px Arial;background:#171717;--font-inter:Arial}*{box-sizing:border-box}button{font-family:inherit;border:0}.fixture-nav{height:54px;display:flex;align-items:center;gap:20px;padding:0 20px;flex-shrink:0}</style><div id="root"></div><script src="/fixture.js"></script></html>';
 res.writeHead(body?200:404,{'Content-Type':mime});res.end(body??'missing');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[],external=[];page.setDefaultTimeout(10000);
 page.on('pageerror',error=>{errors.push(error.message);console.error(error.message)});page.on('console',message=>{if(message.type()==='error'&&/same key|unique.*key|each child.*key/i.test(message.text()))errors.push(message.text());});page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin))external.push(request.url())});
 await page.setViewport({width:1440,height:900});await page.goto(origin);await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.style.zIndex==='1');
 await page.waitForFunction(()=>document.querySelector('.editor-app')?.dataset.playbackOpening==='false');
 assert.equal(await page.$('.footage-preparation'),null,'Tracks open only after a decoded preview and loaded timeline thumbnails');
 const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const stationary=()=>page.evaluate(()=>({page:scrollY,body:document.querySelector('.editor-body').getBoundingClientRect().top,panel:document.querySelector('.preview-inspector').getBoundingClientRect().top,timeline:document.querySelector('.editor-timeline-content').getBoundingClientRect().top}));
 const visible=async key=>{
   const metrics=await page.$eval(`[data-effect="${key}"]`,card=>{const pane=card.closest('.inspector-content'),box=pane.getBoundingClientRect(),heading=card.querySelector('.visual-effect-heading').getBoundingClientRect(),ancestors=[];for(let node=pane;node;node=node.parentElement)ancestors.push({className:node.className,height:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,overflow:getComputedStyle(node).overflowY});return {top:heading.top,bottom:heading.bottom,paneTop:box.top,paneBottom:box.bottom,scrollTop:pane.scrollTop,ancestors};});
   assert.ok(metrics.top>=metrics.paneTop&&metrics.bottom+50<=metrics.paneBottom,JSON.stringify(metrics));return metrics;
 };
 const openSettings=async()=>{
   await page.focus('.timeline-clip[data-clip-id="footage"]');await page.keyboard.press('Enter');await page.waitForSelector('.footage-settings');
   for(const group of ['playback','compositing','fades'])assert.equal(await page.$eval('.footage-'+group,node=>node.open),false,group+' starts collapsed');
   await page.focus('.footage-playback>summary');await page.keyboard.press('Enter');assert.equal(await page.$eval('.footage-playback',node=>node.open),true);
   await page.focus('input[aria-label="Playback speed"]');for(let index=0;index<5;index++)await page.keyboard.press('ArrowRight');
   await page.focus('input[aria-label="Clip volume"]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type('75');await page.keyboard.press('Enter');await flush();
   assert.deepEqual(await page.evaluate(()=>{const clip=window.fixture.getState().timeline.clips[0];return [clip.playbackRate,clip.volume]}),[1.25,.75]);
   const history=await page.evaluate(()=>window.fixture.getState().history.length);await page.focus('.footage-playback>summary');await page.keyboard.press('Enter');await page.keyboard.press('Enter');
   assert.deepEqual(await page.$$eval('.footage-playback input',nodes=>nodes.map(node=>Number(node.value))),[1.25,75],'Collapse/reopen preserves edited speed and volume');assert.equal(await page.evaluate(()=>window.fixture.getState().history.length),history,'Disclosure creates no timeline edits');
   for(const group of ['compositing','fades']){await page.focus('.footage-'+group+'>summary');await page.keyboard.press('Enter');assert.equal(await page.$eval('.footage-'+group,node=>node.open),true);}
 };
 const add=async(category,label,key)=>{await page.locator('::-p-aria([name="Add effect"][role="button"])').click();await page.waitForSelector('.effect-library');await page.click(`[data-category="${category}"]`);const before=await stationary();await page.locator(`::-p-aria([name="${label}"][role="button"])`).click();await page.waitForSelector('.inspector-effect-detail');await flush();assert.equal(await page.$('.footage-settings'),null,'Adding opens the effect page directly');assert.equal(await page.$eval('#inspector-effects',node=>node.scrollTop),0,'A new effect page starts at the top');assert.equal(await page.$$eval('.visual-effect-card',nodes=>nodes.length),1,'The page contains only the newly applied effect');await visible(key);assert.deepEqual(await stationary(),before,'Adding leaves the page, panel and timeline stationary');};
 await openSettings();await add('color','Color & light','colorGrade');await page.focus('[data-effect="colorGrade"] [aria-label="Exposure"]');await page.keyboard.press('ArrowRight');await flush();assert.equal(await page.evaluate(()=>window.fixture.getState().timeline.clips[0].colorGrade.exposure),.01);
 await page.click('[aria-label="Back to clip settings"]');await page.waitForSelector('.footage-settings');await flush();const first=await visible('colorGrade');assert.ok(first.scrollTop>0,'Back reveals the expanded applied row below actual footage controls');assert.equal(await page.$eval('.footage-playback',node=>node.open),false,'Returning to Clip settings starts Playback collapsed');assert.deepEqual(await page.$$eval('.footage-playback input',nodes=>nodes.map(node=>Number(node.value))),[1.25,75],'Dedicated effects preserve speed and volume');assert.equal(await page.$('[aria-label="Back to clip settings"]'),null,'Applied rows remain inline');
 await page.click('[aria-label="Edit Color"]');await flush();const beforeToggle=await page.$eval('#inspector-effects',node=>node.scrollTop);await page.click('[aria-label="Enable Color"]');await flush();assert.equal(await page.$eval('#inspector-effects',node=>node.scrollTop),beforeToggle,'Quick bypass never scrolls');assert.equal(await page.$eval('[aria-label="Edit Color"]',node=>node.getAttribute('aria-expanded')),'false');assert.equal(await page.evaluate(()=>window.fixture.getState().timeline.clips[0].colorGrade.exposure),.01);
 await add('texture','VHS overlay','vhs');await page.screenshot({path:'/tmp/revline-effect-page-full-editor.png'});await page.focus('[data-effect="vhs"] [aria-label="Scanlines"]');await page.keyboard.press('ArrowRight');await flush();assert.equal(await page.evaluate(()=>window.fixture.getState().timeline.clips[0].vhs.scanlines),.36);
 await page.click('[aria-label="Back to clip settings"]');await flush();await visible('vhs');assert.equal(await page.$eval('[aria-label="Edit Color"]',node=>node.getAttribute('aria-expanded')),'false');assert.equal(await page.$eval('[aria-label="Edit VHS overlay"]',node=>node.getAttribute('aria-expanded')),'true');await page.screenshot({path:'/tmp/revline-effect-inline-full-editor.png'});
 await page.click('[aria-label="Remove VHS overlay"]');await flush();assert.ok(await page.$('.footage-settings'));assert.equal(await page.$('.effect-library'),null);assert.equal(await page.$('.inspector-effect-detail'),null,'Deleting expanded row keeps Clip settings');
 // Repeat in Tracks mode at the actual panel's minimum width using its real resize handle.
 await page.click('#editor-tracks-tab');await page.setViewport({width:1280,height:800});await flush();const handle=await page.$('[aria-label="Resize editing panel"]'),box=await handle.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(1279,box.y+box.height/2,{steps:15});await page.mouse.up();await flush();assert.ok(await page.$eval('.preview-inspector',node=>Math.abs(node.clientWidth-320)<2),'Real resizable inspector reaches320px');
 await add('texture','VHS overlay','vhs');await page.click('[aria-label="Remove VHS overlay"]');await flush();assert.ok(await page.$('.footage-settings'),'Deleting from the dedicated page returns to Clip settings');assert.equal(await page.$('.inspector-effect-detail'),null);
 await page.click('[aria-label="Edit Color"]');await flush();await visible('colorGrade');assert.ok(await page.$eval('.preview-inspector',node=>node.scrollWidth<=node.clientWidth),'Expanded Clip settings fits320px');await page.screenshot({path:'/tmp/revline-effect-inline-full-editor-320.png'});
 await page.click('[aria-label="Remove Color"]');await flush();assert.equal(await page.$eval('.applied-visual-effects>p',node=>node.textContent),'No effects applied.');assert.ok(await page.$('.footage-settings'),'Deleting last effect keeps Clip settings');assert.deepEqual(errors,[]);assert.deepEqual(external,[],'No account, AI or external-media requests');console.log('PASS: actual EditorShell in Agentic and Tracks modes; library add opens only the new effect at top; Back reveals inline expanded row in the real inspector scroller; toggles preserve values/scroll; page and inline deletion retain Clip settings; minimum320px panel fits; Playback defaults collapsed and keyboard reopen preserves edited speed/volume without timeline edits; React has no duplicate keys. Local media only.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
