import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { encodeSegmentationMask } from '../node_modules/@meta-sam/parser/dist/mask-codec.js';

// The model endpoint below is entirely synthetic. Only tracking uses a real local model.
const directory=await mkdtemp(join(tmpdir(),'revline-subject-tools-'));
const maskVideo=join(directory,'mask-fixture.mp4'),faceVideo=join(directory,'local-face.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=10:d=2','-vf','drawbox=x=30:y=0:w=8:h=180:color=white:t=fill,drawbox=x=100:y=30:w=80:h=120:color=green:t=fill','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',maskVideo]);
execFileSync('ffmpeg',['-v','error','-ss','0','-i','public/demo/hormozi-distractions.mp4','-t','2','-an','-vf','scale=640:360','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',faceVideo]);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React,{useState}from'react';import{createRoot}from'react-dom/client';import{SubjectToolsLab}from'./components/dev/subject-tools-lab';
  function Fixture(){const[mode,setMode]=useState('masking');return <><nav><button data-mode="masking" onClick={()=>setMode('masking')}>Masking</button><button data-mode="tracking" onClick={()=>setMode('tracking')}>Tracking</button></nav><SubjectToolsLab mode={mode}/></>}
  createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-subject-tools-ui',define:{'process.env.NODE_ENV':'"production"'}});
const encoded=encodeSegmentationMask(new Uint8Array(60*60).fill(1),60,60);
const masks=Array.from({length:20},(_,frame)=>frame===7?'':`<${frame}f>0<|box;x1=100;y1=30;x2=180;y2=150;w=320;h=180|><|mask;x=0;y=0;data=60,60,${encoded.payload}|>\n`).join('');
let posts=0;
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname;
  if(path==='/api/dev/sam'){
    if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end('{"configured":true}');return;}
    for await(const _ of req){}posts++;
    const lane={item_id:'synthetic',output_index:0,content_index:0};
    const events=[{...lane,type:'response.output_text.delta',delta:posts===1?masks:''},{...lane,type:'response.output_text.done',text:posts===1?masks:''},{type:'response.completed'}];
    res.setHeader('Content-Type','text/event-stream');res.end(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''));return;
  }
  if(path.startsWith('/vendor/')){
    const bytes=await readFile('public'+path).catch(()=>null);
    if(!bytes){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',path.endsWith('.wasm')?'application/wasm':path.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(bytes);return;
  }
  const asset=path==='/bundle.js'?['text/javascript',bundle.outputFiles.find(file=>file.path.endsWith('.js')).text]:path==='/style.css'?['text/css',bundle.outputFiles.find(file=>file.path.endsWith('.css')).text]:['text/html','<html><head><link rel="stylesheet" href="/style.css"><style>body{margin:0;background:#16171a;color:#ddd;font:13px Arial}#root{max-width:1100px;padding:28px;margin:auto}nav{display:flex;gap:12px;margin-bottom:20px}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'];
  res.setHeader('Content-Type',asset[0]);res.end(asset[1]);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  await page.setViewport({width:1200,height:900});await page.goto(`http://127.0.0.1:${server.address().port}`);
  const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const pixel=(x,y)=>page.$eval('.subject-lab-mask-canvas',(canvas,{x,y})=>[...canvas.getContext('2d').getImageData(Math.floor(canvas.width*x/320),Math.floor(canvas.height*y/180),1,1).data],{x,y});
  const close=(actual,expected,label)=>assert.ok(actual.every((value,index)=>Math.abs(value-expected[index])<=5),`${label}: ${actual}`);
  const look=async value=>{await page.select('.subject-lab-field select',value);await flush();};
  const fill=async(label,value)=>{const handle=await page.evaluateHandle(label=>[...document.querySelectorAll('label')].find(node=>node.textContent.startsWith(label))?.querySelector('input'),label);assert.ok(handle.asElement(),label);await handle.asElement().click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type(value);await flush();await handle.dispose();};
  await (await page.$('input[type=file]')).uploadFile(maskVideo);
  await page.waitForFunction(()=>!document.querySelector('.subject-lab-primary').disabled);
  assert.equal(posts,0,'Upload never invokes segmentation');
  const green=await pixel(140,90),blue=await pixel(270,20),stripe=await pixel(34,90);
  await page.click('.subject-lab-primary');
  await page.waitForFunction(()=>document.querySelector('.subject-lab-status').textContent.includes('Real SAM masks ready'));
  assert.equal(posts,1);assert.match(await page.$eval('.subject-lab-caption',node=>node.textContent),/19 frames with masks · frame 0: 1 visible masks/);
  await fill('Text behind subject','MMMMMMMM');
  close(await pixel(140,90),green,'Foreground occludes text');
  const accent=await page.$eval('.subject-lab-mask-canvas',canvas=>{const bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]>160&&bytes[i+1]>180&&bytes[i+2]<150)count++;return count;});
  assert.ok(accent>30,'Text paints outside the foreground mask');
  await look('cutout');close(await pixel(140,90),green,'Cutout preserves subject');assert.equal((await pixel(270,20))[3],0,'Cutout background is transparent');
  await look('tint');close(await pixel(140,90),green,'Tint preserves foreground');assert.notDeepEqual(await pixel(270,20),blue,'Tint changes background');
  await look('blur');close(await pixel(140,90),green,'Blur preserves foreground');assert.ok(Math.abs((await pixel(34,90))[0]-stripe[0])>50,'Blur softens background stripe');
  await look('mask');assert.notDeepEqual(await pixel(140,90),green,'Inspect mask colors actual subject');close(await pixel(270,20),blue,'Inspect keeps background unchanged');
  await look('original');close(await pixel(140,90),green,'Original restores subject');close(await pixel(270,20),blue,'Original restores background');
  await look('cutout');
  for(let frame=1;frame<=7;frame++){await page.click('[aria-label="Next frame"]');await page.waitForFunction(frame=>document.querySelector('.subject-lab-caption').textContent.includes(`frame ${frame}:`),{},frame);}
  close(await pixel(270,20),blue,'Missing exact-frame mask shows original footage');
  await page.click('[aria-label="Previous frame"]');await page.waitForFunction(()=>document.querySelector('.subject-lab-caption').textContent.includes('frame 6:'));assert.equal((await pixel(270,20))[3],0,'Previous frame restores exact mask');
  await page.click('[aria-label="Play preview"]');await page.waitForFunction(()=>!document.querySelector('.subject-lab-caption').textContent.includes('frame 6:'));await page.click('[aria-label="Pause preview"]');
  await page.click('.subject-lab-primary');await page.waitForFunction(()=>document.querySelector('.subject-lab-status').textContent.includes('No matching subject found'));close(await pixel(270,20),blue,'Zero-match response clears previous masks');assert.equal(posts,2);
  await page.click('[data-mode="tracking"]');await (await page.$('input[type=file]')).uploadFile(faceVideo);await page.waitForFunction(()=>!document.querySelector('.subject-lab-primary').disabled);
  await page.click('.subject-lab-primary');await page.waitForFunction(()=>document.querySelector('.subject-lab-caption').textContent.includes('4 measured centers'),{timeout:30000});
  const tracked=await page.$eval('.subject-lab-follow-label',node=>({left:parseFloat(node.style.left),top:parseFloat(node.style.top),text:node.textContent}));
  assert.ok(tracked.left>15&&tracked.left<85&&tracked.top>-10&&tracked.top<85,'Real local face path controls the label');
  await fill('Following label','LOCAL FACE');assert.equal(await page.$eval('.subject-lab-follow-label',node=>node.textContent),'LOCAL FACE');
  await page.click('[aria-label="Next frame"]');await page.waitForFunction(()=>parseFloat(document.querySelector('.subject-lab-transport>span').textContent)>0);
  await page.click('[aria-label="Play preview"]');await page.waitForFunction(()=>parseFloat(document.querySelector('.subject-lab-transport>span').textContent)>.15);await page.click('[aria-label="Pause preview"]');
  assert.equal(posts,2,'Local tracking never calls the paid model');assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/revline-subject-tools-verified.png'});
  console.log('PASS: actual SAM parser/player with synthetic SSE masks; text behind subject, transparent cutout, background tint/blur, inspect/original, exact missing-frame fallback, frame steps/playback, zero-match clearing; real local MediaPipe detects 4 face centers from a 2-second local clip and drives editable following label. No paid API contacted.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
