import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition';
import type { Timeline } from '../lib/editor/types';

// Synthetic pixels reproduce the user's crop/contain/transform; no user media or project writes.
async function main() {
  const directory=await mkdtemp(join(tmpdir(),'revline-rounded-contain-'));
  execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30','-t','1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-threads','1','-y',join(directory,'source.mp4')]);
  await writeFile(join(directory,'gradient.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="366"><defs><linearGradient id="g"><stop stop-color="#4365e8"/><stop offset="1" stop-color="#e054ab"/></linearGradient></defs><path fill="url(#g)" d="M0 0h500v366H0z"/></svg>');
  for(const name of ['visual-effects.js','gsap.min.js'])await copyFile(`public/vendor/${name}`,join(directory,name));
  await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'font.woff2'));
  const assets=[{_id:'source',kind:'video' as const,fileName:'source.mp4',url:'./source.mp4',width:1920,height:1080},{_id:'gradient',kind:'image' as const,fileName:'gradient.svg',url:'./gradient.svg',width:500,height:366}];
  const timeline:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:0},clips:[{id:'background',kind:'image',assetId:'gradient',start:0,duration:1,sourceStart:0,track:1,fit:'cover'},{id:'footage',kind:'video',assetId:'source',start:0,duration:1,sourceStart:0,track:2,fit:'contain',crop:{top:.05925925925925926,left:0,right:0,bottom:0},transform:{scale:.84,x:.5,y:.4751,rotation:0,opacity:1},frameCorners:{enabled:true,amount:.06}}]};
  for(const preview of [false,true])await writeFile(join(directory,preview?'preview.html':'index.html'),generateComposition(timeline,assets,{preview,resolution:720,visualEffectsUrl:'./visual-effects.js',gsapUrl:'./gsap.min.js',fontUrl:'./font.woff2'}));
  const server=createServer(async(req,res)=>{const name=(req.url??'/').split('?')[0].slice(1)||'index.html';if(!['index.html','preview.html','source.mp4','gradient.svg','visual-effects.js','gsap.min.js','font.woff2'].includes(name)){res.writeHead(404).end();return;}try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.mp4')?'video/mp4':name.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(join(directory,name)))}catch{res.writeHead(404).end()}});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=512']});
  try{
    const page=await browser.newPage();await page.setViewport({width:1280,height:720});const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
    for(const preview of [false,true]){
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/${preview?'preview.html':''}`,{waitUntil:'networkidle0'});await page.waitForSelector('.visual-effect-output');await page.evaluate('globalThis.__name = (fn) => fn');
      const metrics=await page.evaluate(async()=>{
        const runtime=(window as any).__revlineEffects;const video=document.querySelector('video')!;await new Promise<void>(resolve=>{video.onseeked=()=>resolve();video.currentTime=.5});(window as any).__timelines.revline.seek(.5,false);runtime.redraw();
        const alpha=()=>{const canvas=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;const ctx=copy.getContext('2d')!;ctx.drawImage(canvas,0,0);const pixels=ctx.getImageData(0,0,copy.width,copy.height).data;let removed=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]<250)removed++;const sample=(x:number,y:number)=>pixels[(Math.floor(y)*copy.width+Math.floor(x))*4+3];const x=(-video.offsetLeft+2)/video.offsetWidth*copy.width,y=(-video.offsetTop+2)/video.offsetHeight*copy.height;return{removed,pixels:Array.from(pixels),corner:sample(x,y),top:sample(copy.width/2,y)}};
        const rounded=alpha();runtime.set('clip-1',{frameCorners:{enabled:false,amount:.06},colorGrade:{enabled:true,exposure:0,contrast:1,saturation:1,temperature:0,tint:0,vibrance:0.000001}});runtime.redraw();const square=alpha();let difference=0;for(let i=3;i<rounded.pixels.length;i+=4)if(rounded.pixels[i]!==square.pixels[i])difference++;runtime.set('clip-1',{frameCorners:{enabled:true,amount:.06}});runtime.redraw();const parent=video.parentElement!,r=parent.getBoundingClientRect();return{corner:rounded.corner,top:rounded.top,squareCorner:square.corner,removed:rounded.removed,squareRemoved:square.removed,changedAlphaPixels:difference,sourceWindow:{left:r.left,top:r.top,width:r.width,height:r.height}};
      });
      assert.equal(metrics.corner,0,'Visible crop corner reveals gradient');assert.equal(metrics.squareCorner,255,'Disabling corners restores opaque square boundary');assert.equal(metrics.top,255,'Top-edge center remains opaque');assert(metrics.changedAlphaPixels>10,`6% rounding must change visible cropped corners: ${JSON.stringify(metrics)}`);await page.screenshot({path:`/tmp/revline-rounded-contain-${preview?'preview':'export'}.png`});console.log(JSON.stringify({preview,...metrics}));
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
