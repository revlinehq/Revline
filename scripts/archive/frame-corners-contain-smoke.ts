import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { generateComposition } from '../../lib/editor/composition';
import type { Timeline } from '../../lib/editor/types';

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
      await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/${preview?'preview.html':''}`,{waitUntil:'networkidle0'});await page.evaluate('globalThis.__name = (fn) => fn');
      await page.waitForFunction(()=>!!(window as any).__revlineEffects);
      // Corner-only rounding is native CSS on the crop window in preview and export (bd50edd, f6c5d30):
      // no effect canvas, no per-frame upload. Verify the actual composited pixels instead of canvas alpha.
      await page.evaluate(async()=>{const video=document.querySelector('video')!;await new Promise<void>(resolve=>{video.onseeked=()=>resolve();video.currentTime=.5});(window as any).__timelines.revline.seek(.5,false);(window as any).__revlineEffects.redraw();});
      const windowState=()=>page.evaluate(()=>{const node=document.querySelector('video')!.parentElement!,r=node.getBoundingClientRect();return{radius:node.style.borderRadius,width:parseFloat(node.style.width)||node.clientWidth,height:parseFloat(node.style.height)||node.clientHeight,rect:{left:r.left,top:r.top,width:r.width,height:r.height},canvas:!!document.querySelector('.visual-effect-output')};});
      const capture=async()=>{const{data,info}=await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});return{data,width:info.width};};
      const at=(image:{data:Buffer;width:number},x:number,y:number)=>{const i=(Math.floor(y)*image.width+Math.floor(x))*3;return [image.data[i],image.data[i+1],image.data[i+2]];};
      const distance=(a:number[],b:number[])=>a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]),0);
      const rounded=await windowState();
      assert.equal(rounded.canvas,false,'Corner-only rounding stays native without an effect canvas');
      assert.ok(Math.abs(parseFloat(rounded.radius)-.06*Math.min(rounded.width,rounded.height)*.5)<.01,`Native radius matches the export mask in untransformed window pixels: ${rounded.radius}`);
      const corner={x:rounded.rect.left+2,y:rounded.rect.top+2},top={x:rounded.rect.left+rounded.rect.width/2,y:rounded.rect.top+2};
      const roundedPixels=await capture();
      await page.evaluate(()=>{(window as any).__revlineEffects.set('clip-1',{frameCorners:{enabled:false,amount:.06}});(window as any).__revlineEffects.redraw();});
      const square=await windowState();const squarePixels=await capture();
      await page.evaluate(()=>{document.querySelector('video')!.parentElement!.style.visibility='hidden';});const background=await capture();
      await page.evaluate(()=>{document.querySelector('video')!.parentElement!.style.visibility='';(window as any).__revlineEffects.set('clip-1',{frameCorners:{enabled:true,amount:.06}});(window as any).__revlineEffects.redraw();});
      let changed=0;for(let i=0;i<roundedPixels.data.length;i+=3)if(distance([roundedPixels.data[i],roundedPixels.data[i+1],roundedPixels.data[i+2]],[squarePixels.data[i],squarePixels.data[i+1],squarePixels.data[i+2]])>24)changed++;
      const metrics={corner:at(roundedPixels,corner.x,corner.y),squareCorner:at(squarePixels,corner.x,corner.y),backgroundCorner:at(background,corner.x,corner.y),top:at(roundedPixels,top.x,top.y),squareTop:at(squarePixels,top.x,top.y),changedPixels:changed,squareRadius:square.radius,sourceWindow:rounded.rect};
      assert.ok(distance(metrics.corner,metrics.backgroundCorner)<=24,`Visible crop corner reveals gradient: ${JSON.stringify(metrics)}`);
      assert.ok(distance(metrics.squareCorner,metrics.backgroundCorner)>24,`Disabling corners restores the square footage boundary: ${JSON.stringify(metrics)}`);
      assert.ok(distance(metrics.top,metrics.squareTop)<=24,'Top-edge center remains footage');
      assert.ok(metrics.changedPixels>10,`6% rounding must change visible cropped corners: ${JSON.stringify(metrics)}`);
      await page.screenshot({path:`/tmp/revline-rounded-contain-${preview?'preview':'export'}.png`});console.log(JSON.stringify({preview,...metrics}));
    }
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1});
