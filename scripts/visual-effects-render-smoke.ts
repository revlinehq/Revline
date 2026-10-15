import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { generateComposition } from '../lib/editor/composition';
import { DEFAULT_COLOR_GRADE, DEFAULT_INVERT, DEFAULT_GLITCH, DEFAULT_ZOOM_BLUR, DEFAULT_LENS_DISTORTION, DEFAULT_FILM_OVERLAY, DEFAULT_SOFT_BLUR, DEFAULT_FRAME_DISTORTION, DEFAULT_FRAME_CORNERS } from '../lib/editor/visual-effects';
import type { Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'revline-visual-effects-'));
  const server = createServer(async (req, res) => {
    const name = req.url?.split('?')[0].slice(1) || 'index.html';
    if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
    if (!['index.html','preview.html','source.mp4','visual-effects.js','gsap.min.js','space-grotesk-latin.woff2'].includes(name)) { res.writeHead(404).end(); return; }
    try { res.setHeader('Content-Type', name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.js') ? 'application/javascript' : 'text/html'); const data = await readFile(join(directory, name));
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) { const start=Number(range[1]),end=range[2]?Number(range[2]):data.length-1;res.writeHead(206,{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});res.end(data.subarray(start,end+1)); }
      else {res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',data.length);res.end(data);}  } catch { res.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader'] });
  try {
    execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=1','-c:v','libx264','-pix_fmt','yuv420p','-y',join(directory,'source.mp4')]);
    await copyFile('public/vendor/visual-effects.js', join(directory,'visual-effects.js'));
    await copyFile('public/vendor/gsap.min.js', join(directory,'gsap.min.js'));
    await copyFile('public/fonts/space-grotesk-latin.woff2', join(directory,'space-grotesk-latin.woff2'));
    const settings = { frameDistortion:{...DEFAULT_FRAME_DISTORTION,enabled:true,bend:.65,horizontal:.5,vertical:.25,skew:.2},frameCorners:{...DEFAULT_FRAME_CORNERS,enabled:true,amount:.65}, softBlur:{...DEFAULT_SOFT_BLUR,enabled:true,amount:35}, lensDistortion:{...DEFAULT_LENS_DISTORTION,enabled:true,amount:.45,fringing:5},filmOverlay:{...DEFAULT_FILM_OVERLAY,enabled:true,amount:1,grain:.8,dust:.8,vignette:.7,warmth:.5},invert: { ...DEFAULT_INVERT, enabled: true }, colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: -.5, saturation: .55, temperature: 40 }, zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true, amount: .45 }, glitch: { ...DEFAULT_GLITCH, enabled: true, intensity: .85, blockSize: 65, rgbSplit: 35 } };
    const renderSettings = settings;
    const timeline: Timeline = { fps: 24, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [{ id: 'video', kind: 'video', assetId: 'source', start: 0, sourceStart: 0, duration: 1, track: 1, volume: 0, ...renderSettings }] };
    await writeFile(join(directory,'index.html'), generateComposition(timeline, [{ _id: 'source', kind: 'video', fileName: 'source.mp4', url: './source.mp4', width: 320, height: 180 }], { resolution: 720, visualEffectsUrl: './visual-effects.js', gsapUrl: './gsap.min.js', fontUrl: './space-grotesk-latin.woff2' }));
    await writeFile(join(directory,'preview.html'), generateComposition(timeline, [{ _id: 'source', kind: 'video', fileName: 'source.mp4', url: './source.mp4', width: 320, height: 180 }], { preview:true,resolution:720,visualEffectsUrl:'./visual-effects.js',gsapUrl:'./gsap.min.js',fontUrl:'./space-grotesk-latin.woff2' }));
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('canvas.visual-effect-output', { timeout: 8000 }).catch(async error => { console.error({ errors, state: await page.evaluate(() => ({ runtime: !!(window as any).__revlineEffects, time: (window as any).__timelines?.revline?.time(), videos: [...document.querySelectorAll('video')].map(v => ({ ready: v.readyState, width: v.videoWidth, error: v.error?.message })) })) }); throw error; });
    const readPixels = () => page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('.visual-effect-output')!;
      const scaled = document.createElement('canvas'); scaled.width = 32; scaled.height = 18;
      const ctx = scaled.getContext('2d')!; ctx.fillStyle='#000';ctx.fillRect(0,0,32,18); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(canvas, 0, 0, 32, 18);
      return Array.from(ctx.getImageData(0, 0, 32, 18).data).filter((_, i) => i % 4 !== 3);
    });
    const update = async (effects: object) => { await page.evaluate(effects => { (window as any).__revlineEffects.set('clip-0', effects); }, effects); };
    const neutral = { colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: .0001 } };
    await update(neutral);
    const baseline = await readPixels();
    const distance = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
    for (const key of ['colorGrade','zoomBlur','glitch','invert','lensDistortion','filmOverlay','softBlur','frameDistortion','frameCorners'] as const) {
      await update({ [key]: settings[key] });
      const difference=distance(baseline, await readPixels());
      assert.ok(difference > (key==='softBlur'? .5 : key==='frameCorners'?1:5), `${key} must actually change pixels (difference ${difference.toFixed(2)})`);
    }
    await update({frameDistortion:settings.frameDistortion});
    assert.equal(await page.evaluate(()=>{const source=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,c=document.createElement('canvas');c.width=source.width;c.height=source.height;const ctx=c.getContext('2d')!;ctx.drawImage(source,0,0);return ctx.getImageData(0,0,1,1).data[3];}),0,'Perspective leaves unused corners transparent for lower layers');
    const alphaShape = () => page.evaluate(() => {
      const source=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(source,0,0);const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const values=[[.01,.01],[.5,.5],[.01,.5]].map(([x,y])=>data[(Math.min(canvas.height-1,Math.floor(y*canvas.height))*canvas.width+Math.min(canvas.width-1,Math.floor(x*canvas.width)))*4+3]);
      const edges=[.25,.5].map(y=>{const row=Math.floor(y*canvas.height);for(let x=0;x<canvas.width;x++)if(data[(row*canvas.width+x)*4+3]>127)return x/canvas.width;return 1;});
      return {corner:values[0],center:values[1],side:values[2],quarter:edges[0],middle:edges[1]};
    });
    for(const bend of [.8,-.8]){
      await update({frameDistortion:{...DEFAULT_FRAME_DISTORTION,enabled:true,bend}});const shape=await alphaShape();
      assert.equal(shape.center,255,'Bending preserves opaque central footage');assert.equal(bend>0?shape.corner:shape.side,0,'Bending leaves real transparent space along its curved outline');
      assert.ok(bend>0?shape.quarter>shape.middle+.005:shape.middle>shape.quarter+.005,`Bend ${bend} must curve entire outer edges, not only trim corners: ${JSON.stringify(shape)}`);
    }
    await update({...neutral,frameDistortion:{enabled:true,horizontal:0,vertical:0,skew:0}});const legacy=await alphaShape();assert.equal(legacy.corner,255,'Saved perspective without bend keeps its original square silhouette');
    await update({frameCorners:{enabled:true,amount:.8}});const rounded=await alphaShape();assert.equal(rounded.corner,0,'Independent clip rounding produces transparent corners with Frame distortion absent');assert.equal(rounded.side,255,'Independent corner rounding retains the middle of each straight edge');assert.equal(rounded.center,255);
    await update({...neutral,frameCorners:{enabled:false,amount:.8}});assert.equal((await alphaShape()).corner,255,'Bypassing corner rounding restores square corners');
    await update({frameCorners:{enabled:true,amount:.8}});
    const cropped=await page.evaluate(()=>{const source=document.querySelector('video')!,window=source.parentElement!,original=[source.style.left,source.style.top,window.style.width,window.style.height],width=source.offsetWidth,height=source.offsetHeight;source.style.left=`${-width*.15}px`;source.style.top=`${-height*.1}px`;window.style.width=`${width*.7}px`;window.style.height=`${height*.8}px`;(globalThis as any).__revlineEffects.redraw();const output=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,canvas=document.createElement('canvas');canvas.width=output.width;canvas.height=output.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(output,0,0);const values=[[.16,.11],[.16,.5]].map(([x,y])=>ctx.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data[3]);[source.style.left,source.style.top,window.style.width,window.style.height]=original;(globalThis as any).__revlineEffects.redraw();return values;});assert.deepEqual(cropped,[0,255],'Corner radius follows the visible cropped window instead of hidden original-source corners');

    await update({ invert: settings.invert });
    const negative = await readPixels();
    assert.ok(distance(negative, baseline.map(value => 255 - value)) < 2, 'Full inversion must produce actual negative RGB colors');
    await update({ invert: { enabled: true, amount: .5 } });
    assert.ok((await readPixels()).every(value => Math.abs(value - 128) <= 1), 'Half inversion mixes each channel to middle gray');
    await update(renderSettings);
    await page.evaluate(async () => {
      const video = document.querySelector('video')!;
      const decoded = new Promise<void>((resolve, reject) => { video.addEventListener('seeked', () => resolve(), { once: true }); setTimeout(() => reject(new Error('Video seek timed out')), 5000); });
      video.currentTime = .5; await decoded;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      (window as any).__timelines.revline.seek(.5, false); (window as any).__revlineEffects.redraw();
    });
    const preview = await readPixels();
    await page.evaluate(() => { (window as any).__timelines.revline.seek(.75, false); (window as any).__timelines.revline.seek(.5, false); (window as any).__revlineEffects.redraw(); });
    assert.deepEqual(await readPixels(), preview, 'Glitch and film must be deterministic at the same frame');
    await update({});
    assert.equal(await page.$('canvas.visual-effect-output'), null, 'Disabled effects must free their canvas');
    assert.equal(await page.$$eval('video', nodes => nodes.length), 1, 'Effects must not clone video decoders');
    assert.deepEqual(errors.filter(message => !message.includes('favicon')), []);
    const livePreview=await browser.newPage();await livePreview.setViewport({width:1280,height:720});await livePreview.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/preview.html`,{waitUntil:'networkidle0'});await livePreview.waitForSelector('.visual-effect-output');
    const livePixels=await livePreview.evaluate(async()=>{const video=document.querySelector('video')!;await new Promise<void>((resolve,reject)=>{video.addEventListener('seeked',()=>resolve(),{once:true});setTimeout(()=>reject(new Error('Preview seek timed out')),5000);video.currentTime=.5;});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));(window as any).__timelines.revline.seek(.5,false);(window as any).__revlineEffects.redraw();const source=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,32,18);ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,32,18);return Array.from(ctx.getImageData(0,0,32,18).data).filter((_,i)=>i%4!==3);});
    assert.ok(distance(preview,livePixels)<12,`Actual combined preview/export composition mismatch: ${distance(preview,livePixels).toFixed(2)}`);
    const shapeSettings={frameDistortion:settings.frameDistortion,frameCorners:settings.frameCorners};await update(shapeSettings);const shapeExport=await readPixels();await livePreview.evaluate(effects=>(window as any).__revlineEffects.set('clip-0',effects),shapeSettings);
    const shapePreview=await livePreview.evaluate(()=>{const source=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,32,18);ctx.imageSmoothingQuality='high';ctx.drawImage(source,0,0,32,18);return Array.from(ctx.getImageData(0,0,32,18).data).filter((_,i)=>i%4!==3);});assert.ok(distance(shapeExport,shapePreview)<6,`Bend/corner actual preview/export parity error: ${distance(shapeExport,shapePreview).toFixed(2)}`);const alphaCaptures=[];for(const target of [page,livePreview])alphaCaptures.push(await target.evaluate(()=>{const source=document.querySelector<HTMLCanvasElement>('.visual-effect-output')!,canvas=document.createElement('canvas');canvas.width=source.width;canvas.height=source.height;const ctx=canvas.getContext('2d')!;ctx.drawImage(source,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;return Array.from({length:32*18},(_,cell)=>{const column=cell%32,row=Math.floor(cell/32),left=Math.floor(column*canvas.width/32),right=Math.floor((column+1)*canvas.width/32),top=Math.floor(row*canvas.height/18),bottom=Math.floor((row+1)*canvas.height/18);let total=0;for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)total+=pixels[(y*canvas.width+x)*4+3];return total/((right-left)*(bottom-top));});}));const alphaError=distance(alphaCaptures[0],alphaCaptures[1]);assert.ok(alphaError<2,`Bend/corner preview/export alpha mismatch: ${alphaError.toFixed(2)}`);await livePreview.close();

    const output = join(directory,'output.mp4');
    const result = await runRenderWorker(directory, output, { fps:24,quality:'high' }, () => {}, AbortSignal.timeout(90_000));
    assert.equal(result.warnings, 0);
    const exported = [...execFileSync('ffmpeg', ['-v','error','-ss','0.5','-i',output,'-vf','scale=32:18','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'])];
    const error = distance(preview, exported);
    assert.ok(error < 12, `Preview/export pixel mismatch: mean error ${error.toFixed(2)}`);
    assert.ok(distance(baseline, exported) > 5, 'Export must include effects');
    console.log(`PASS: real MP4 curved frame silhouettes, separate rounded clip corners, perspective/skew, lens distortion, film overlay, color, radial zoom blur, deterministic RGB/block glitch and negative inversion; preview/export mean pixel error ${error.toFixed(2)}, geometry alpha error ${alphaError.toFixed(2)}, one decoder and disabled canvas cleanup.`);
  } finally { await browser.close(); server.close(); await rm(directory, { recursive:true,force:true }); }
}
main().catch(error => { console.error(error); process.exitCode=1; });
