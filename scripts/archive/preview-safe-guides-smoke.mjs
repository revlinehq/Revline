import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const source=await sharp({create:{width:360,height:640,channels:3,background:'#d04f32'}}).png().toBuffer();
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef} from 'react';import {createRoot} from 'react-dom/client';import {Preview} from './components/editor/preview';import {PreviewZoomProvider,PreviewZoomControls,PreviewViewport} from './components/editor/preview-zoom';import {EditorStateProvider} from './components/editor/editor-state';import {createEditorStore} from './lib/editor/store';import './app/editor.css';
const clip={id:'source',kind:'image',assetId:'source',track:1,start:0,duration:4,sourceStart:0};const timeline={fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[clip]},assets=[{_id:'source',kind:'image',fileName:'Generated fixture',width:360,height:640,url:location.origin+'/source.png'}];const store=createEditorStore(timeline);
function Fixture(){const preview=useRef(null);window.fixture={opacity:value=>preview.current.clipEffects('source',value===null?null:{transform:{x:.5,y:.5,scale:1,rotation:0,opacity:value}})};return <PreviewZoomProvider canvas={{width:1080,height:1920}}><div className="canvas-toolbar"><PreviewZoomControls/></div><div className="stage-center"><PreviewViewport><Preview ref={preview} timeline={timeline} assets={assets} time={0} muted selectedClip={clip} onTime={()=>{}} onPlaying={()=>{}} onError={error=>window.errors.push(error)}/></PreviewViewport></div></PreviewZoomProvider>};window.errors=[];createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-safe-guide-fixture',define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer(async(request,response)=>{try{
 const path=new URL(request.url,'http://fixture').pathname;
 if(path==='/')return response.setHeader('Content-Type','text/html').end('<html><body><main id="root" class="editor-app conversation-editor"></main><link rel="stylesheet" href="/fixture.css"><script src="/fixture.js"></script></body></html>');
 if(path==='/source.png')return response.setHeader('Content-Type','image/png').end(source);
 if(path==='/fixture.js')return response.setHeader('Content-Type','application/javascript').end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);
 if(path==='/fixture.css')return response.setHeader('Content-Type','text/css').end(bundle.outputFiles.find(file=>file.path.endsWith('.css')).text+'body{margin:0}#root{width:700px;height:700px;margin:auto}.stage-center{flex:1;min-height:0}');
 if(/^\/(vendor|fonts)\/[\w.-]+$/.test(path))return response.end(await readFile('public'+path));
 response.writeHead(404).end();
 }catch{response.writeHead(500).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:800,height:760});await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'load'});
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('#clip-0')?.complete);
 await page.waitForFunction(()=>!document.querySelector('.preview-loading'));
 await page.evaluate(()=>{window.before={player:document.querySelector('hyperframes-player'),document:document.querySelector('hyperframes-player').iframeElement.contentDocument};});
 await page.click('[aria-label="Show safe guides"]');await page.waitForSelector('.preview-safe-area');
 const geometry=()=>page.evaluate(()=>{const frame=document.querySelector('.preview-viewport-frame').getBoundingClientRect(),guide=document.querySelector('.preview-safe-area').getBoundingClientRect();return{left:(guide.left-frame.left)/frame.width,right:(frame.right-guide.right)/frame.width,top:(guide.top-frame.top)/frame.height,bottom:(frame.bottom-guide.bottom)/frame.height,pointer:getComputedStyle(document.querySelector('.preview-safe-guides')).pointerEvents}});
 for(let i=0;i<2;i++){const box=await geometry();assert.ok(Math.abs(box.left-.08)<.002&&Math.abs(box.right-.16)<.002&&Math.abs(box.top-.12)<.002&&Math.abs(box.bottom-.2)<.002);assert.equal(box.pointer,'none');if(!i)await page.click('[aria-label="Zoom out preview"]');}
 await page.evaluate(()=>window.fixture.opacity(.4));assert.equal(await page.evaluate(()=>window.before.document.getElementById('clip-0-frame').style.opacity),'0.4');
 await page.evaluate(()=>window.fixture.opacity(null));assert.equal(await page.evaluate(()=>window.before.document.getElementById('clip-0-frame').style.opacity),'1');
 await page.click('[aria-label="Hide safe guides"]');assert.equal(await page.$('.preview-safe-guides'),null);
 assert.equal(await page.evaluate(()=>document.querySelector('hyperframes-player')===window.before.player&&document.querySelector('hyperframes-player').iframeElement.contentDocument===window.before.document),true,'Guide toggles, preview zoom and opacity drafts retain the player and decoded media');
 assert.equal(await page.evaluate(()=>window.before.document.querySelector('.preview-safe-guides')),null,'Guides remain outside the video composition and export');assert.deepEqual(await page.evaluate(()=>window.errors),[]);assert.deepEqual(errors,[]);
 console.log('PASS: vertical guides follow preview zoom, stay outside the composition, pass pointer input through and retain player/media; opacity drafts/cancel repaint the existing frame.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
