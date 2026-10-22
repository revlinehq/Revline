import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const source=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#49627a"/><path d="M0 60H640M0 120H640M0 180H640M0 240H640M0 300H640M80 0V360M160 0V360M240 0V360M320 0V360M400 0V360M480 0V360M560 0V360" stroke="#e0c8a0" stroke-width="5"/><circle cx="320" cy="180" r="60" fill="#d38864"/></svg>')).png().toBuffer();
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';import {Preview} from './components/editor/preview';import {VisualEffectsControls} from './components/editor/visual-effects-controls';import {FootageSettings} from './components/editor/footage-settings';import './app/editor.css';import './components/workspace/workspace-pages.css';
const asset={_id:'source',kind:'image',fileName:'Lens test grid',width:640,height:360,url:location.origin+'/source.png'};
function Fixture(){const preview=useRef(null),[clip,setClip]=useState({id:'image',kind:'image',assetId:'source',start:0,duration:3,sourceStart:0,track:1});const change=patch=>setClip(c=>({...c,...patch}));window.fixture={clip,seek:time=>preview.current.seek(time)};return <><div className="stage"><Preview ref={preview} timeline={{fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[clip]}} assets={[asset]} time={.3} muted onTime={()=>{}} onPlaying={()=>{}} onError={message=>window.errors.push(message)}/></div><aside className="preview-inspector"><FootageSettings clip={clip} asset={asset} onCrop={()=>{}} cropping={false} onChange={change} onPreview={patch=>preview.current.clipEffects('image',patch)}/><VisualEffectsControls clip={clip} onChange={change} onPreview={patch=>preview.current.clipEffects('image',patch)}/></aside></>};window.errors=[];createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,outdir:'/tmp/revline-lens-fixture',define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  const body=path==='/fixture.js'?bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents:path==='/fixture.css'?bundle.outputFiles.find(f=>f.path.endsWith('.css')).text+'\n*{box-sizing:border-box}body{margin:0;font:12px Arial;background:#171717;color:#eee}main{display:flex;gap:20px;padding:20px;width:1000px;height:700px}.stage{width:640px;height:360px;position:relative;flex-shrink:0}.preview-inspector{width:300px;height:650px;overflow:auto;padding:10px}.visual-effects-menu [role=menuitem]{padding:8px}.visual-effects-menu{background:#222}':path==='/source.png'?source:path==='/'?'<html data-workspace-theme="dark"><head><link rel="stylesheet" href="/fixture.css"></head><body><main id="root"></main><script src="/fixture.js"></script></body></html>':await readFile('public'+path).catch(()=>null);
  res.writeHead(body?200:404,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':path.endsWith('.woff2')?'font/woff2':'text/html'});res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1020,height:700});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
  const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const shot=async()=>{const n=await page.$('.stage');return n.screenshot();};
  const pixels=async()=>sharp(await shot()).removeAlpha().raw().toBuffer();
  const distance=(a,b)=>a.reduce((s,v,i)=>s+Math.abs(v-b[i]),0)/a.length;
  const baseline=await pixels();
  await page.evaluate(()=>{const p=document.querySelector('hyperframes-player');window.original={player:p,document:p.iframeElement.contentDocument,source:p.iframeElement.contentDocument.querySelector('img.visual')};});
  const add=async name=>{await page.click('.visual-effects-add');await page.locator('::-p-aria([name="'+name+'"][role="menuitem"])').click();await flush();};
  await add('Lens distortion');assert.ok(await page.$('[aria-label="Bend"]'));assert.ok(distance(baseline,await pixels())>3,'Lens bends the actual grid');
  await page.focus('input[aria-label="Bend"]');await page.keyboard.press('ArrowRight');await flush();assert.ok(await page.evaluate(()=>window.fixture.clip.lensDistortion.amount>.28));
  await add('Frame distortion');assert.ok(await page.$('input[aria-label="Horizontal tilt"]'));assert.ok(await page.$('input[aria-label="Skew"]'));
  await add('Film overlay');assert.ok(await page.$('input[aria-label="Grain"]'));
  await page.evaluate(()=>{window.fixture.seek(.3);});await flush();const first=await pixels();
  await page.evaluate(()=>{window.fixture.seek(.8);});await flush();assert.ok(distance(first,await pixels())>.1,'Film texture animates even on a still image');
  await page.evaluate(()=>{window.fixture.seek(.3);});await flush();assert.deepEqual(await pixels(),first,'Film returns to exactly the same pixels at the same frame');
  assert.equal(await page.$('[data-effect="softBlur"]'),null,'Whole-clip blur is a clip setting rather than an effect card');
  // Blur and opacity live in the collapsed Compositing disclosure of Clip settings.
  await page.click('details.footage-compositing > summary');await page.waitForSelector('input[aria-label="Blur"]',{visible:true});
  await page.focus('input[aria-label="Blur"]');for(let i=0;i<20;i++)await page.keyboard.press('ArrowRight');await flush();
  assert.equal(await page.evaluate(()=>window.fixture.clip.softBlur.amount),10);assert.ok(distance(first,await pixels())>1,'Clip blur actually softens pixels');
  await page.focus('input[aria-label="Opacity"]');await page.keyboard.press('ArrowLeft');await flush();assert.ok(await page.evaluate(()=>window.fixture.clip.transform.opacity<1),'Blur combines with clip transparency');
  assert.ok(await page.evaluate(()=>{const p=document.querySelector('hyperframes-player');return p===window.original.player&&p.iframeElement.contentDocument===window.original.document&&p.iframeElement.contentDocument.querySelector('img.visual')===window.original.source;}),'Live effects retain the same decoded source and player');
  await page.click('[aria-label="Reset Lens distortion"]');await flush();assert.equal(await page.evaluate(()=>window.fixture.clip.lensDistortion.amount),.28);
  await page.screenshot({path:'/tmp/revline-lens-film-controls.png'});
  await page.click('[aria-label="Remove Film overlay"]');await flush();assert.equal(await page.evaluate(()=>window.fixture.clip.filmOverlay),undefined);
  assert.deepEqual(await page.evaluate(()=>window.errors),[]);assert.deepEqual(errors,[]);
  console.log('PASS: lens/film controls, deterministic animated still-image grain, clip-settings blur with opacity, live source retention and reset/removal.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
