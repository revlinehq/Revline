import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer';
import { generateComposition } from '../../lib/editor/composition';
import { splitClip } from '../../lib/editor/operations';
import { VFX_TEXT_PRESETS } from '../../lib/editor/remotion-text';
import { textTemplatePatch } from '../../lib/editor/text-effects';
import type { Clip, Timeline } from '../../lib/editor/types';
import { runRenderWorker } from '../../lib/server/render-worker';

// Chromium can round transformed glyph edge colors by 1–2 levels after repaint.
// Compare bounded pixel statistics; Buffer assertion diffs can exhaust desktop RAM.
function assertSamePixels(actual:Buffer,expected:Buffer,message:string){
  const decode=(image:Buffer)=>execFileSync('ffmpeg',['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','-'],{input:image,maxBuffer:4*1024*1024});
  const a=decode(actual),b=decode(expected);assert.equal(a.length,b.length,message);
  let total=0,max=0;for(let index=0;index<a.length;index++){const difference=Math.abs(a[index]-b[index]);total+=difference;max=Math.max(max,difference);}
  assert.ok(total/a.length<.01&&max<=3,`${message}: mean ${total/a.length}, maximum ${max}`);
}

// Isolated authored composition: no local editor, account, backend or remote media.
async function main(){
  const directory=await mkdtemp(join(tmpdir(),'revline-lyric-render-'));
  const files=new Set(['index.html','remotion-text.js','visual-effects.js','gsap.min.js','space-grotesk-latin.woff2']);
  const server=createServer(async(request,response)=>{
    const name=new URL(request.url??'/','http://127.0.0.1').pathname.slice(1)||'index.html';
    if(!files.has(name)){response.writeHead(404).end();return;}
    try{response.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.woff2')?'font/woff2':'text/html');response.end(await readFile(join(directory,name)));}catch{response.writeHead(404).end();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try{
    for(const name of ['remotion-text.js','visual-effects.js','gsap.min.js'])await copyFile(`public/vendor/${name}`,join(directory,name));
    await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'space-grotesk-latin.woff2'));
    const clips:Clip[]=VFX_TEXT_PRESETS.map((preset,index)=>{
      const clip:Clip={id:preset,kind:'graphic',track:index+1,start:0,duration:2,sourceStart:0,text:['LATE NIGHTS\nBRIGHT LIGHTS','MAKE IT\nLOUD','YOUR NEXT\nBIG MOVE'][index],fontSize:108,x:.5,y:[.19,.50,.81][index]};
      return {...clip,...textTemplatePatch(clip,preset)};
    });
    const timeline:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:3,overlay:0,audio:0,effects:0},clips};
    const saveComposition=(value:Timeline)=>writeFile(join(directory,'index.html'),generateComposition(value,[],{resolution:720,gsapUrl:'./gsap.min.js',visualEffectsUrl:'./visual-effects.js',remotionTextUrl:'./remotion-text.js',fontUrl:'./space-grotesk-latin.woff2'}));
    await saveComposition(timeline);
    browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage(),errors:string[]=[];
    page.on('pageerror',error=>errors.push(String(error)));
    await page.setViewport({width:1280,height:720});
    await page.goto(`http://127.0.0.1:${(server.address() as {port:number}).port}/`,{waitUntil:'networkidle0'});
    await page.evaluate(()=>document.fonts.ready);
    // The standalone fixture supplies HyperFrames' declared clip visibility.
    // MP4 below exercises the real producer's own activation of these roots.
    const paint=async(frame:number)=>{await page.evaluate(frame=>{
      const time=frame/30;(window as any).__timelines.revline.seek(time,false);
      document.querySelectorAll<HTMLElement>('[data-start][data-end]').forEach(node=>{node.style.visibility=time>=Number(node.dataset.start)&&time<Number(node.dataset.end)?'visible':'hidden'});
    },frame);
    // Chromium keeps raster state from the previously painted frame: re-entering an identical DOM
    // from an opacity-0 frame can shift a fractional-line glyph row by 1px. Force a fresh raster so
    // pixels depend only on the composition's DOM state; textState() below checks that state exactly.
    await page.evaluate(()=>new Promise<void>(resolve=>{document.body.style.visibility='hidden';requestAnimationFrame(()=>requestAnimationFrame(()=>{document.body.style.visibility='';requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()));}));}));
    return Buffer.from(await page.screenshot());};
    const textState=()=>page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>node.outerHTML));
    const frames=new Map<number,Buffer>();
    for(const frame of [2,21,56]){
      const screenshot=await paint(frame);
      assert.deepEqual(await page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>node.getAttribute('data-frame'))),Array(3).fill(String(frame)));
      await writeFile(`/tmp/revline-lyric-preview-${frame}.png`,screenshot);
      const pixels=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-f','rawvideo','-pix_fmt','rgb24','-'],{input:screenshot,maxBuffer:4*1024*1024});
      frames.set(frame,pixels);
      const state=await textState();
      await paint(59);await paint(0);
      assertSamePixels(await paint(frame),screenshot,'Backward seeks preserve the rendered frame');
      assert.deepEqual(await textState(),state,'Backward seeks rebuild the identical text DOM');
      await new Promise(resolve=>setTimeout(resolve,85));
      assertSamePixels(Buffer.from(await page.screenshot()),screenshot,'A paused frame never starts an independent clock');
    }
    const rowPixels=(frame:number,row:number)=>frames.get(frame)!.subarray(row*240*1280*3,(row+1)*240*1280*3);
    for(let index=0;index<3;index++){
      assert.ok(!rowPixels(2,index).equals(rowPixels(21,index)),`${VFX_TEXT_PRESETS[index]} has real entrance motion`);
      assert.ok(!rowPixels(56,index).equals(rowPixels(21,index)),`${VFX_TEXT_PRESETS[index]} has real exit motion`);
    }
    await paint(21);
    for(const [index,preset] of VFX_TEXT_PRESETS.entries())await page.screenshot({path:`/tmp/revline-lyric-${preset}.png`,clip:{x:180,y:index*240,width:920,height:240}});
    const beforeSplit=await paint(36);
    await saveComposition(splitClip(timeline,'neon-echo',1,'neon-ending'));
    await page.reload({waitUntil:'networkidle0'});await page.evaluate(()=>document.fonts.ready);
    assertSamePixels(await paint(36),beforeSplit,'Splitting the actual composition preserves the neon frame/exit timing');
    assert.deepEqual(errors,[]);
    // Render the split persisted shape too, through the same production export worker.
    const output=join(directory,'output.mp4');
    const result=await runRenderWorker(directory,output,{fps:30,quality:'high'},()=>{},AbortSignal.timeout(90_000));
    assert.equal(result.warnings,0);await copyFile(output,'/tmp/revline-lyric-export.mp4');
    const errorsByFrame:string[]=[];
    for(const [frame,preview] of frames){
      const exported=execFileSync('ffmpeg',['-v','error','-ss',String(frame/30),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});
      assert.equal(exported.length,preview.length);
      const differences=[0,0,0];let painted=0;
      for(let index=0;index<preview.length;index++){
        const row=Math.min(2,Math.floor(index/(240*1280*3)));// Normalize the uniform H.264 black-level shift before comparing text signal.
        const channel=index%3;differences[row]+=Math.abs((preview[index]-preview[channel])-(exported[index]-exported[channel]));
        if(exported[index]>100)painted++;
      }
      execFileSync('ffmpeg',['-v','error','-ss',String(frame/30),'-i',output,'-frames:v','1','-y',`/tmp/revline-lyric-export-${frame}.png`]);
      for(const [row,difference] of differences.entries())assert.ok(difference/(240*1280*3)<3,`${VFX_TEXT_PRESETS[row]} preview/export frame${frame} differ: ${difference/(240*1280*3)}`);
      assert.ok(painted>1000,'Export paints the lyric text');
      errorsByFrame.push(`${frame}: ${differences.map(value=>(value/(240*1280*3)).toFixed(3)).join('/')}`);
    }
    console.log(`PASS: 3 distinct animated lyric presets enter/hold/exit on the composition clock, deterministic backward/paused frames, actual split preserves motion, production MP4 matches preview. RGB errors ${errorsByFrame.join('; ')}. Screenshots /tmp/revline-lyric-{neon-echo,lyric-slam,kinetic-stack}.png`);
  }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
