import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const directory = await mkdtemp(join(tmpdir(), 'revline-scripted-demo-'));
const footagePath = join(directory, 'source.mp4');
execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','12','-threads','1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',footagePath]);
const stubs = {
  'next/navigation': `const params=new URLSearchParams();export const useSearchParams=()=>params;`,
  '@/components/workspace/workspace-nav': `import React from 'react';export const WorkspaceNav=p=><header className="demo-fixture-nav"><span>revline</span>{p.editorControls}<button id="undo" disabled={!p.canUndo} onClick={p.onUndo}>Undo</button><button id="redo" disabled={!p.canRedo} onClick={p.onRedo}>Redo</button></header>;`,
};
const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {TooltipProvider} from './components/ui/tooltip';import {ScriptedDemoEditor} from './components/editor/scripted-demo-editor';import './components/workspace/shared.css';import './app/editor.css';import './components/workspace/workspace-pages.css';
const make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.liveURLs=new Set();URL.createObjectURL=blob=>{const url=make(blob);window.liveURLs.add(url);return url};URL.revokeObjectURL=url=>{window.liveURLs.delete(url);revoke(url)};const root=createRoot(document.getElementById('root'));window.unmountDemo=()=>root.unmount();root.render(<TooltipProvider><ScriptedDemoEditor demoId="recording-take"/></TooltipProvider>);
`},plugins:[{name:'local-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));}}],bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:directory,define:{'process.env.NODE_ENV':'"production"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;let body,mime='text/html';
  if(path==='/fixture.js'){body=js;mime='text/javascript';}
  else if(path.startsWith('/vendor/')||path.startsWith('/fonts/')){body=await readFile('public'+path).catch(()=>null);mime=path.endsWith('.js')?'text/javascript':path.endsWith('.woff2')?'font/woff2':'application/octet-stream';}
  else body='<html data-workspace-theme="dark"><style>'+css+'body{margin:0;font:12px Arial;background:#171717;--foreground:#f4f4f0;--font-inter:Arial}*{box-sizing:border-box}.demo-fixture-nav{height:54px;display:flex;align-items:center;gap:15px;padding:0 20px;flex-shrink:0}.editor-app{height:900px}</style><div id="root"></div><script src="/fixture.js"></script></html>';
  res.writeHead(body?200:404,{'Content-Type':mime});res.end(body??'missing');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage(),errors=[],external=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(origin))external.push(req.url())});
  await page.setViewport({width:1440,height:900});await page.goto(origin);await page.waitForSelector('.manual-editor-composer');
  const raw=(await readFile(footagePath)).toString('base64');
  await page.evaluate(raw=>{const bytes=Uint8Array.from(atob(raw),c=>c.charCodeAt(0)),transfer=new DataTransfer();transfer.items.add(new File([bytes],'Local fight.mp4',{type:'video/mp4'}));const composer=document.querySelector('.manual-editor-composer');composer.dispatchEvent(new DragEvent('dragenter',{bubbles:true,dataTransfer:transfer}));composer.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:transfer}));composer.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));},raw);
  await page.waitForFunction(()=>document.querySelectorAll('.composer-attachment').length===1&&!document.querySelector('.composer-attachment progress'));
  assert.equal(await page.$('.timeline-clip'),null,'Dropping files attaches them without adding timeline clips');
  await page.$eval('[aria-label="Demo build speed"]',node=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,'2');node.dispatchEvent(new Event('change',{bubbles:true}));node.dispatchEvent(new Event('input',{bubbles:true}))});
  await page.evaluate(()=>{window.counts=[];window.arrivals=[];const observer=new MutationObserver(()=>{const count=document.querySelectorAll('.timeline-clip').length;window.counts.push(count);for(const node of document.querySelectorAll('.timeline-clip'))if(!window.arrivals.some(x=>x.id===node.dataset.clipId))window.arrivals.push({id:node.dataset.clipId,animation:getComputedStyle(node).animationName})});observer.observe(document.querySelector('.timeline-track-area'),{subtree:true,childList:true});window.demoObserver=observer});
  await page.type('[aria-label="Describe your next edit"]','Make it hype, with "ONE GOOD MOMENT" as the caption');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.scripted-editor-demo').dataset.building==='true');
  assert.equal(await page.$eval('[aria-label="Describe your next edit"]',node=>node.value),'','Sending clears the composer immediately');
  await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip').length>0);assert.ok(await page.$$eval('.timeline-clip',nodes=>nodes.length<12),'Timeline starts with a partial build');
  await page.screenshot({path:'/tmp/revline-demo-building.png'});
  await page.waitForFunction(()=>!document.querySelector('.scripted-editor-demo').dataset.building);
  assert.equal(await page.$$eval('.timeline-clip.clip-video',nodes=>nodes.length),4);
  assert.equal(await page.$$eval('.timeline-clip.clip-caption',nodes=>nodes.length),4);
  assert.equal(await page.$$eval('.timeline-clip.clip-effect',nodes=>nodes.length),4);
  const observed=await page.evaluate(()=>({counts:[...new Set(window.counts)],arrivals:window.arrivals}));assert.ok(observed.counts.length>=6,'Clips build across multiple timed stages');assert.ok(observed.arrivals.every(item=>item.animation==='demo-block-arrive'),'Actual mounted blocks use the arrival animation');
  await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.style.zIndex==='1');
  assert.match(await page.$eval('.chat-assistant',node=>node.textContent),/4 shots/);
  await page.screenshot({path:'/tmp/revline-demo-finished.png'});
  await page.click('#undo');await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip').length===0);await page.click('#redo');await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip').length===12);
  await page.click('[aria-label="Replay demo"]');await page.waitForFunction(()=>document.querySelector('.scripted-editor-demo').dataset.building==='true');await page.waitForFunction(()=>document.querySelectorAll('.timeline-clip').length>0);await page.click('[aria-label="Stop editing"]');await page.waitForFunction(()=>!document.querySelector('.scripted-editor-demo').dataset.building);const stopped=await page.$$eval('.timeline-clip',nodes=>nodes.length);await new Promise(resolve=>setTimeout(resolve,1200));assert.equal(await page.$$eval('.timeline-clip',nodes=>nodes.length),stopped,'Stopped run cannot keep appending clips');
  await page.click('[aria-label="Replay demo"]');await page.waitForFunction(()=>document.querySelector('.scripted-editor-demo').dataset.building==='true');await page.click('[aria-label="Reset demo"]');await page.waitForFunction(()=>!document.querySelector('.scripted-editor-demo').dataset.building);await new Promise(resolve=>setTimeout(resolve,900));assert.equal(await page.$('.timeline-clip'),null,'Reset cancels stale build callbacks');assert.equal(await page.$$eval('.composer-attachment',nodes=>nodes.length),1,'Reset keeps footage for the next take');
  await page.evaluate(()=>{window.demoObserver.disconnect();window.unmountDemo()});assert.equal(await page.evaluate(()=>window.liveURLs.size),0,'Local URLs are released on unmount');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[],'The local demo makes no AI/provider or remote media requests');console.log('PASS: real editor demo uploads/drops, composer clearing, incremental animated cuts/captions/FX, native preview, grouped Undo/Redo, replay/stop/reset, URL cleanup and zero external requests.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
