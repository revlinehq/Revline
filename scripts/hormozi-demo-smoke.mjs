import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const directory = await mkdtemp(join(tmpdir(), 'revline-scripted-demo-'));
const stubs = {
  'next/navigation': `const params=new URLSearchParams();export const useSearchParams=()=>params;`,
  '@/components/workspace/workspace-nav': `import React from 'react';export const WorkspaceNav=p=><header className="demo-fixture-nav"><span>revline</span>{p.editorControls}<button id="undo" disabled={!p.canUndo} onClick={p.onUndo}>Undo</button><button id="redo" disabled={!p.canRedo} onClick={p.onRedo}>Redo</button></header>;`,
};
const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {TooltipProvider} from './components/ui/tooltip';import {ScriptedDemoEditor} from './components/editor/scripted-demo-editor';import './components/workspace/shared.css';import './app/editor.css';import './components/workspace/workspace-pages.css';
const make=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.liveURLs=new Set();URL.createObjectURL=blob=>{const url=make(blob);window.liveURLs.add(url);return url};URL.revokeObjectURL=url=>{window.liveURLs.delete(url);revoke(url)};const root=createRoot(document.getElementById('root'));window.unmountDemo=()=>root.unmount();root.render(<TooltipProvider><ScriptedDemoEditor demoId="hormozi-take-1"/></TooltipProvider>);
`},plugins:[{name:'local-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));}}],bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:directory,define:{'process.env.NODE_ENV':'"production"'}});
const js=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text,css=bundle.outputFiles.find(file=>file.path.endsWith('.css')).text;
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;let body,mime='text/html';
  if(path==='/fixture.js'){body=js;mime='text/javascript';}
  else if(path==='/demo/hormozi-distractions.mp4'){body=await readFile('public'+path);mime='video/mp4';}
  else if(path.startsWith('/vendor/')||path.startsWith('/fonts/')){body=await readFile('public'+path).catch(()=>null);mime=path.endsWith('.js')?'text/javascript':path.endsWith('.woff2')?'font/woff2':'application/octet-stream';}
  else body='<html data-workspace-theme="dark"><style>'+css+'body{margin:0;font:12px Arial;background:#171717;--foreground:#f4f4f0;--font-inter:Arial}*{box-sizing:border-box}.demo-fixture-nav{height:54px;display:flex;align-items:center;gap:15px;padding:0 20px;flex-shrink:0}.editor-app{height:900px}</style><div id="root"></div><script src="/fixture.js"></script></html>';
  if(mime==='video/mp4'&&req.headers.range){const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range),start=Number(match[1]),end=Math.min(body.length-1,match[2]?Number(match[2]):body.length-1);res.writeHead(206,{'Content-Type':mime,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1});res.end(body.subarray(start,end+1));return;}
  res.writeHead(body?200:404,{'Content-Type':mime,...(body?{'Content-Length':Buffer.byteLength(body)}:{})});res.end(body??'missing');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage(),errors=[],external=[];page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(/^https?:/.test(req.url())&&!req.url().startsWith(origin))external.push(req.url())});
  await page.setViewport({width:1440,height:900});await page.goto(origin);await page.waitForSelector('.manual-editor-composer');
  for(const name of ['Unrelated image.png','Different footage.mp4']){
    if(name.endsWith('mp4')){await page.click('[aria-label="Reset edit"]');await page.click('[aria-label="Remove Unrelated image.png"]');}
    await page.evaluate(name=>{const transfer=new DataTransfer();transfer.items.add(new File(['placeholder bytes'],name,{type:name.endsWith('png')?'image/png':'video/mp4'}));document.querySelector('.manual-editor-composer').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}));},name);
    await page.waitForFunction(()=>document.querySelectorAll('.composer-attachment').length===1&&!document.querySelector('[aria-label="Describe your next edit"]').disabled);
    await page.evaluate(()=>{window.clipCounts=new Set();window.buildObserver=new MutationObserver(()=>window.clipCounts.add(document.querySelectorAll('.timeline-clip.clip-video').length));window.buildObserver.observe(document.querySelector('.timeline-track-area'),{childList:true,subtree:true});});
    await page.type('[aria-label="Describe your next edit"]','Add subtitles and precise subtle zooms');await page.click('[aria-label="Start edit"]');
    await page.waitForFunction(()=>!document.querySelector('.scripted-editor-demo').dataset.building&&document.querySelectorAll('.timeline-clip.clip-caption').length===30,{timeout:30000});
    assert.ok(await page.evaluate(()=>{window.buildObserver.disconnect();return window.clipCounts.size>=8;}),'Clip blocks must arrive across separate animated stages');
    assert.equal(await page.$$eval('.timeline-clip.clip-video',n=>n.length),10);assert.equal(await page.$$eval('.clip-audio',n=>n.length),10);assert.equal(await page.$$eval('.clip-effect',n=>n.length),2);assert.equal(await page.$('.composer-attachment'),null);
    await page.waitForFunction(()=>[...document.querySelectorAll('.audio-waveform[data-waveform-ready="true"] canvas')].some(c=>c.width>0&&c.height>0&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((value,i)=>i%4===3&&value>0)));
    assert.equal(await page.$$eval('.timeline-cut-transition.has-transition',n=>n.length),0,'No decorative transitions are added');
    assert.match(await page.$eval('.chat-assistant',n=>n.textContent),/30 animated/);
    await page.waitForFunction(()=>[...document.querySelectorAll('hyperframes-player')].some(p=>p.style.zIndex==='1')).catch(async error=>{console.log(await page.evaluate(()=>({players:[...document.querySelectorAll('hyperframes-player')].map(p=>({style:p.getAttribute('style'),media:[...(p.iframeElement?.contentDocument?.querySelectorAll('video,audio')??[])].map(v=>({src:v.src,ready:v.readyState,error:v.error?.message}))})),alerts:[...document.querySelectorAll('[role=alert]')].map(n=>n.textContent)})));throw error;});
    const wordStates=[];
    for(const time of [2.7,3.6]){
      await page.evaluate(time=>{[...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1').iframeElement.contentWindow.__timelines.revline.seek(time);},time);
      wordStates.push(await page.evaluate(()=>{
        const d=[...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1').iframeElement.contentDocument;
        const phrase=[...d.querySelectorAll('[data-remotion-text="karaoke"]')].find(n=>n.textContent==='THIS IS INTERESTING BECAUSE AS'&&n.closest('.overlay').style.display!=='none');
        return [...phrase.querySelectorAll('[data-word-index]')].map(n=>({background:n.style.backgroundColor,left:n.offsetLeft,width:n.offsetWidth,top:n.offsetTop}));
      }));
    }
    assert.equal(wordStates[0][0].background,'rgb(196, 181, 253)');
    assert.equal(wordStates[1][3].background,'rgb(196, 181, 253)','Speech highlighting follows the actual word rather than evenly spaced intervals');
    assert.deepEqual(wordStates[0].map(({background,...layout})=>layout),wordStates[1].map(({background,...layout})=>layout),'Caption words never move when the spoken highlight changes');
    await page.evaluate(()=>{[...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1').iframeElement.contentWindow.__timelines.revline.seek(26.74);});
    await new Promise(r=>setTimeout(r,500));
    const rendered=await page.evaluate(()=>{const d=[...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1').iframeElement.contentDocument;return {source:d.querySelector('video')?.src,text:d.body.textContent};});
    assert.ok(rendered.source.includes('/demo/hormozi-distractions.mp4'),'Any uploaded file renders the prepared Hormozi source');assert.ok(rendered.text.toLowerCase().includes('of indigestion,'));assert.ok(await page.evaluate(()=>!![...document.querySelectorAll('hyperframes-player')].find(p=>p.style.zIndex==='1').iframeElement.contentDocument.querySelector('[data-remotion-text="karaoke"]')),'Captions use the actual speech-timed caption renderer');assert.equal(await page.$('[role="alert"]'),null);
  }
  await page.screenshot({path:'/tmp/revline-hormozi-subtitles-preview.png'});
  await page.evaluate(()=>window.unmountDemo());assert.equal(await page.evaluate(()=>window.liveURLs.size),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: arbitrary image and video trigger the same real 45-second source in ten contiguous pieces, 30 speech-timed captions, two precise zooms, original audio with real painted waveforms, no lost source frames, clean replay/reset and no external AI requests.');
} catch(error){console.error(error);throw error;} finally {server.closeAllConnections();await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
