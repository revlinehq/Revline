import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { generateComposition } from '../../lib/editor/composition.ts';
import { DEFAULT_DITHER } from '../../lib/editor/visual-effects.ts';
import { previewContentKey } from '../../lib/editor/preview-content-key.ts';

const settings={...DEFAULT_DITHER,enabled:true,levels:2,size:1};
const timeline={fps:30,aspectRatio:'landscape',clips:[{id:'source',kind:'image',assetId:'image',start:0,duration:3,sourceStart:0,dither:settings}]};
const assets=[{_id:'image',kind:'image',fileName:'Synthetic gradient',width:32,height:32,url:'/synthetic.png'}];
assert.equal(previewContentKey(timeline,assets),previewContentKey({...timeline,clips:[{...timeline.clips[0],dither:{...settings,levels:8}}]},assets),'Adjusting dither must not rebuild decoded media');
assert.ok(generateComposition(timeline,assets).includes('"dither":'+JSON.stringify(settings)),'Export composition forwards the saved dither controls to its shared kernel');
const bundle=await build({entryPoints:['lib/editor/visual-effects-runtime.ts'],bundle:true,platform:'browser',format:'iife',globalName:'__revlineVisualEffects',write:false});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=768']});const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
 await page.setViewport({width:240,height:160});await page.setContent('<body><div style="position:relative;width:32px;height:32px"><img id="clip-0" data-start="0" data-duration="3" style="position:absolute;width:32px;height:32px"></div></body>');
 await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.fillStyle='rgba(128,128,128,0.5)';ctx.fillRect(0,0,32,32);const image=document.getElementById('clip-0');image.src=canvas.toDataURL();await image.decode();window.nativeSource=image;window.time=0;window.__timelines={revline:{time:()=>window.time,render:()=>{}}};window.__hf={colorGrading:{redraw:()=>{window.bridgeDraws=(window.bridgeDraws??0)+1}}}});
 await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(settings=>window.__revlineVisualEffects.installVisualEffects([{id:'clip-0',dither:settings}],30,1080),settings);
 await page.waitForSelector('.visual-effect-output');
 const read=()=>page.evaluate(()=>{const canvas=document.querySelector('.visual-effect-output'),gl=canvas.getContext('webgl'),bytes=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from(bytes)});
 const update=async patch=>{await page.evaluate(patch=>window.__revlineEffects.set('clip-0',{dither:patch}),patch)};
 const reds=bytes=>bytes.filter((_,index)=>index%4===0);
 const original=await read(),levels=new Set(reds(original));assert.deepEqual([...levels].sort((a,b)=>a-b),[0,255],'Two levels produce actual binary channel values');
 const white=reds(original).filter(value=>value===255).length;assert.ok(white>=480&&white<=544,'Bayer distributes middle gray evenly');assert.ok(original.filter((_,index)=>index%4===3).every(value=>Math.abs(value-128)<=1),'Dither preserves source alpha');
 await update({...settings,levels:4});assert.deepEqual([...new Set(reds(await read()))].sort((a,b)=>a-b),[85,170],'Color levels change the output palette');
 await update({...settings,amount:.5});assert.deepEqual([...new Set(reds(await read()))].sort((a,b)=>a-b),[64,192],'Strength blends with the original rather than only changing a label');
 await update({...settings,size:2});const coarse=reds(await read());for(let y=0;y<32;y+=2)for(let x=0;x<32;x+=2){const value=coarse[y*32+x];assert.equal(coarse[y*32+x+1],value);assert.equal(coarse[(y+1)*32+x],value);assert.equal(coarse[(y+1)*32+x+1],value)}
 await update({...settings,shadowColor:'#0000ff',highlightColor:'#ffff00'});const palette=await read();const colors=new Set();for(let i=0;i<palette.length;i+=4)colors.add(palette.slice(i,i+3).join(','));assert.deepEqual([...colors].sort(),['0,0,255','255,255,0'],'Configured dark/light colors form the actual shader palette');
 await update({...settings,size:2});
 const sourceCanvas=await page.evaluate(()=>document.querySelector('.visual-effect-output').width);
 // Idle previews no longer poll (638ab12): a transform change reaches the shader through the player's next clock render.
 await page.evaluate(()=>{document.getElementById('clip-0').parentElement.style.transform='rotate(30deg) scale(2)';window.__timelines.revline.render();});
 await page.waitForFunction(()=>{const c=document.querySelector('.visual-effect-output'),g=c.getContext('webgl'),v=new Uint8Array(c.width*c.height*4);g.readPixels(0,0,c.width,c.height,g.RGBA,g.UNSIGNED_BYTE,v);return v[0]!==v[4];});
 assert.equal(await page.evaluate(()=>document.querySelector('.visual-effect-output').width),sourceCanvas,'Transform adjusts the shader without rebuilding its canvas');
 const fine=reds(await read());assert.notEqual(fine[0],fine[1],'At 2× scale the pattern halves its local cell width, preserving composition block size');
 await page.evaluate(()=>{document.getElementById('clip-0').parentElement.style.transform='none';window.__revlineEffects.redraw();});
 const hash=values=>values.reduce((sum,value,index)=>(sum+value*(index+1))%2147483647,0);const before=hash(await read());await page.evaluate(()=>{window.time=1;window.__revlineEffects.redraw();window.time=.5;window.__revlineEffects.redraw()});assert.equal(hash(await read()),before,'Ordered pattern is frame deterministic');
 // Exercise the same injected decoded-frame bridge that export uses, without an MP4 encoder job.
 await page.evaluate(async()=>{const image=new Image();image.id='__render_frame_clip-0__';image.src=window.nativeSource.src;document.body.appendChild(image);await image.decode();window.__hf.colorGrading.redraw()});assert.equal(hash(await read()),before,'Export decoded-frame bridge renders the same dither pixels');assert.equal(await page.evaluate(()=>window.bridgeDraws),1);
 await update({...settings,amount:0});assert.equal(await page.$('.visual-effect-output'),null,'Zero strength releases GPU resources');assert.equal(await page.evaluate(()=>document.getElementById('clip-0')===window.nativeSource),true,'Original source node stays mounted');assert.equal(await page.$eval('#clip-0',node=>node.hasAttribute('data-revline-effects')),false,'Bypass restores source visibility');
 // A full-resolution iframe CSS-scaled to its preview is the real player layout.
 const previewPage=await browser.newPage();await previewPage.setViewport({width:640,height:360});
 await previewPage.setContent('<iframe style="width:1920px;height:1080px;transform:scale(.3333333333);transform-origin:top left;border:0"></iframe>');
 const previewFrame=previewPage.frames().find(frame=>frame.parentFrame());
 await previewFrame.setContent('<meta name="hyperframes-studio-preview"><div id="composition" data-width="1920" data-height="1080"><div style="transform:scale(2)"><img id="clip-0" data-start="0" data-duration="3" style="position:absolute;width:1920px;height:1920px"></div></div>');
 await previewFrame.evaluate(async source=>{const image=document.getElementById('clip-0');image.src=source;await image.decode();window.__timelines={revline:{time:()=>0,render:()=>{}}};},await page.evaluate(()=>window.nativeSource.src));
 await previewFrame.addScriptTag({content:bundle.outputFiles[0].text});await previewFrame.evaluate(settings=>window.__revlineVisualEffects.installVisualEffects([{id:'clip-0',dither:settings}],30,1080),settings);
 const tiny=await previewFrame.evaluate(()=>{const c=document.querySelector('.visual-effect-output'),gl=c.getContext('webgl'),bytes=new Uint8Array(c.width*c.height*4);gl.readPixels(0,0,c.width,c.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);let sum=0;for(let index=0;index<bytes.length;index+=4)sum+=bytes[index];return {width:c.width,meanRed:sum/(bytes.length/4)};});
 assert.equal(tiny.width,640,'Preview density follows CSS-scaled iframe display size');
 console.log('CSS-scaled subpixel dither tone',tiny);
 assert.ok(tiny.meanRed>96&&tiny.meanRed<160,'Subpixel Bayer cells retain middle-gray tone instead of aliasing to a solid black/white frame');
 await previewPage.close();
 assert.deepEqual(errors,[]);console.log('PASS: actual 32×32 Bayer shader RGB/custom color palette, strength, block size, alpha, deterministic frames, export decoded-frame bridge, CSS-scaled preview density, subpixel tone filtering, no source rebuild and GPU cleanup. Synthetic only.');
}finally{await browser.close()}
