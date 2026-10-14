import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
// Meta's internal encoder is used only to generate deterministic synthetic conformance masks.
import { encodeSegmentationMask } from '../node_modules/@meta-sam/parser/dist/mask-codec.js';

const directory=await mkdtemp(join(tmpdir(),'revline-sam-fixture-'));
const videoPath=join(directory,'fixture.mp4');
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=240x136:r=10:d=1','-vf','drawbox=x=30:y=30:w=60:h=60:color=green:t=fill','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','-y',videoPath]);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SamMaskLab} from './components/editor/sam-mask-lab';import './components/workspace/shared.css';createRoot(document.getElementById('root')).render(<SamMaskLab/>);`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-sam-ui',define:{'process.env.NODE_ENV':'"production"'}});
const mask=encodeSegmentationMask(new Uint8Array(60*60).fill(1),60,60);
const maskText=Array.from({length:10},(_,frame)=>`<${frame}f>0<|box;x1=30;y1=30;x2=90;y2=90;w=240;h=136|><|mask;x=0;y=0;data=60,60,${mask.payload}|>\n`).join('');
let calls=0;
const server=createServer(async(req,res)=>{
 if(req.url==='/api/dev/sam'){
  if(req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end('{"configured":true}');}
  for await(const _ of req){} calls++;
  const text=calls===1?maskText:'';
  const lane={item_id:'fixture',output_index:0,content_index:0};
  const events=[{...lane,type:'response.output_text.delta',delta:text},{...lane,type:'response.output_text.done',text},{type:'response.completed'}];
  res.setHeader('Content-Type','text/event-stream');return res.end(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(''));
 }
 const path=req.url?.split('?')[0];
 const asset=path==='/bundle.js'?['text/javascript',bundle.outputFiles.find(file=>file.path.endsWith('.js')).text]:path==='/style.css'?['text/css',bundle.outputFiles.find(file=>file.path.endsWith('.css')).text]:['text/html','<html><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script src="/bundle.js"></script></body></html>'];
 res.setHeader('Content-Type',asset[0]);res.end(asset[1]);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.setViewport({width:1280,height:850});await page.goto(`http://127.0.0.1:${server.address().port}/dev/sam`);
 await (await page.$('input[type=file]')).uploadFile(videoPath);
 await page.waitForFunction(()=>document.querySelector('.sam-lab-playback span')&&parseFloat(document.querySelector('.sam-lab-playback span').textContent.split('/')[1])>0,{timeout:8000}).catch(async error=>{console.log(await page.$eval('body',el=>el.textContent),errors);throw error;});
 assert.equal(calls,0,'Selecting a file never calls Meta');
 const pixel=()=>page.$eval('.sam-lab-preview canvas',canvas=>{const ctx=canvas.getContext('2d'),x=Math.floor(canvas.width*60/240),y=Math.floor(canvas.height*60/136);return [...ctx.getImageData(x,y,1,1).data];});
 const raw=await pixel();
 await page.click('.sam-lab-settings .revline-primary');
 await page.waitForFunction(()=>document.querySelector('.sam-lab-status')?.textContent?.includes('1 tracked subjects · 10 frames'),{timeout:8000}).catch(async error=>{console.log('STATE',await page.$eval('body',el=>el.textContent),errors,'calls',calls);throw error;});
 await page.waitForFunction(()=>!document.querySelector('.sam-lab-settings .revline-primary').disabled);
 const masked=await pixel();assert.notDeepEqual(masked,raw,'Decoded mask visibly overlays the subject');
 await page.click('.sam-lab-toggle input');
 await page.waitForFunction(raw=>{const c=document.querySelector('.sam-lab-preview canvas'),data=[...c.getContext('2d').getImageData(Math.floor(c.width*60/240),Math.floor(c.height*60/136),1,1).data];return data.every((value,index)=>value===raw[index]);},{},raw);
 await page.click('.sam-lab-toggle input');
 await page.click('.sam-lab-playback .revline-primary');
 await page.waitForFunction(()=>!document.querySelector('.sam-lab-playback span').textContent.startsWith('0.00'));
 await page.click('.sam-lab-playback .revline-primary');
 assert.ok(await page.$eval('.sam-lab-playback span',el=>parseFloat(el.textContent)>0),'Playback advances');
 await page.click('.sam-lab-settings .revline-primary');
 await page.waitForFunction(()=>document.querySelector('.sam-lab-status')?.textContent?.includes('No matching subjects'));
 assert.equal(calls,2);
 await page.screenshot({path:'/tmp/revline-sam-lab-fixture.png'});
 assert.deepEqual(errors,[]);
 console.log('PASS: actual SAM parser/player render synthetic masks on generated video, raw/mask toggle recomposes, playback advances, zero-match response clears masks, no automatic provider calls. No Meta account contacted.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
