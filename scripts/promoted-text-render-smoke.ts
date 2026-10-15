import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { generateComposition } from '../lib/editor/composition';
import { splitClip } from '../lib/editor/operations';
import { EXPRESSIVE_TEXT_DEFAULTS, REMOTION_TEXT_LABELS, type RemotionTextPreset } from '../lib/editor/remotion-text';
import type { Clip, Timeline } from '../lib/editor/types';
import { runRenderWorker } from '../lib/server/render-worker';

async function main(){
const EXPRESSIVE_TEXT_PRESETS=['rgb-split','type-trails','blur-focus','character-scramble','spotlight-sweep','ink-write','tunnel-zoom'] as const;
const fps=24,frames=[0,6,84];
const directory=await mkdtemp(join(tmpdir(),'revline-promoted-text-'));
const files=new Set(['index.html','ui.html','ui.js','ui.css','remotion-text.js','visual-effects.js','gsap.min.js','space-grotesk-latin.woff2']);
const server=createServer(async(request,response)=>{
  const name=new URL(request.url??'/','http://127.0.0.1').pathname.slice(1)||'index.html';
  if(!files.has(name)){response.writeHead(404).end();return;}
  try{response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.woff2')?'font/woff2':'text/html');response.end(await readFile(join(directory,name)));}catch{response.writeHead(404).end();}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
try{
  for(const name of ['remotion-text.js','visual-effects.js','gsap.min.js'])await copyFile(`public/vendor/${name}`,join(directory,name));
  await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'space-grotesk-latin.woff2'));
  const ui=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TextEffectsControls}from'./components/editor/text-effects-controls';
    function Fixture(){const[clip,setClip]=useState({id:'text',kind:'caption',track:1,start:0,duration:4,sourceStart:0,text:'Words and timing stay intact',fontSize:64,color:'#ffffff',background:'transparent'});window.currentClip=clip;return <TextEffectsControls clip={clip} onChange={patch=>setClip(previous=>({...previous,...patch}))}/>}
    createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',outdir:directory,define:{'process.env.NODE_ENV':'"production"'}});
  await writeFile(join(directory,'ui.js'),ui.outputFiles.find(file=>file.path.endsWith('.js'))!.text);await writeFile(join(directory,'ui.css'),ui.outputFiles.find(file=>file.path.endsWith('.css'))!.text);
  await writeFile(join(directory,'ui.html'),'<link rel="stylesheet" href="/ui.css"><style>body{margin:0;background:#171717;color:white;font:13px Arial}#root{width:470px;padding:20px}</style><div id="root"></div><script src="/ui.js"></script>');
  browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error instanceof Error?error.message:String(error)));
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const save=async(timeline:Timeline,resolution:720|1080)=>{
    let html=generateComposition(timeline,[],{resolution,gsapUrl:'./gsap.min.js',visualEffectsUrl:'./visual-effects.js',remotionTextUrl:'./remotion-text.js',fontUrl:'./space-grotesk-latin.woff2'});
    html=html.replace('</style>',`.overlay{width:42%;max-width:42%}.overlay[data-text-clip^="blur-focus"]{width:${360*resolution/1080}px;max-width:${360*resolution/1080}px}</style>`);
    await writeFile(join(directory,'index.html'),html);
  };
  const load=async()=>{await page.goto(origin,{waitUntil:'networkidle0'});await page.evaluate(()=>document.fonts.ready);};
  const paint=async(frame:number)=>{await page.evaluate(frame=>{(window as any).__timelines.revline.seek(frame/24,false);},frame);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(null)))));return Buffer.from(await page.screenshot());};
  const rgb=async(png:Buffer)=>sharp(png).removeAlpha().raw().toBuffer();
  // Chromium can reuse a different glyph antialiasing raster after a transform
  // settles. Exact markup/geometry below guards state; this bounds edge-only paint.
  const same=async(first:Buffer,second:Buffer,label:string)=>{const[a,b]=await Promise.all([rgb(first),rgb(second)]);assert.equal(a.length,b.length);let total=0,maximum=0;for(let i=0;i<a.length;i++){const difference=Math.abs(a[i]-b[i]);total+=difference;maximum=Math.max(maximum,difference);}if(total/a.length>=.35||maximum>200){await writeFile('/tmp/revline-promoted-difference-a.png',first);await writeFile('/tmp/revline-promoted-difference-b.png',second);const metadata=await sharp(first).metadata(),cells=[0,0,0,0];for(let i=0;i<a.length;i++){const pixel=Math.floor(i/3),cell=(pixel%metadata.width!<metadata.width!/2?0:1)+(pixel<metadata.width!*metadata.height!/2?0:2);cells[cell]+=Math.abs(a[i]-b[i]);}console.log({label,cells});}assert.ok(total/a.length<.35&&maximum<=200,`${label}: mean ${total/a.length}, max ${maximum}`);};
  const geometry=()=>page.$eval('[data-remotion-text="blur-focus"]',node=>{const element=node as HTMLElement;return{width:element.offsetWidth,height:element.offsetHeight,overlay:[element.closest<HTMLElement>('.overlay')!.offsetWidth,element.closest<HTMLElement>('.overlay')!.offsetHeight],words:[...element.querySelectorAll<HTMLElement>('[data-focus-word]')].map(word=>[word.offsetLeft,word.offsetTop,word.offsetWidth,word.offsetHeight])};});
  for(const resolution of [720,1080] as const){
    const width=resolution*16/9,height=resolution;await page.setViewport({width,height});
    const timeline:Timeline={fps,aspectRatio:'landscape',tracks:{visual:7,overlay:0,audio:0,effects:0},clips:EXPRESSIVE_TEXT_PRESETS.map((preset,index)=>({id:preset,kind:'graphic',track:index+1,start:0,duration:4,sourceStart:0,text:preset==='blur-focus'?'HOLD THESE LINES AS FOCUS MOVES':'MAKE IDEAS MOVE',fontSize:preset==='blur-focus'?48:60,color:'#ffffff',background:'transparent',x:index%2?.75:.25,y:(Math.floor(index/2)+.5)/4,textTemplate:{preset,duration:4,offset:0,...EXPRESSIVE_TEXT_DEFAULTS}}))};
    await save(timeline,resolution);await load();
    const references=new Map<number,Buffer>(),layouts=[];
    for(const frame of frames){
      const screenshot=await paint(frame),rects=await page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return[r.x,r.y,r.width,r.height];})),markup=await page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>node.outerHTML));references.set(frame,await rgb(screenshot));layouts.push(await geometry());
      assert.deepEqual(await page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>node.getAttribute('data-frame'))),Array(7).fill(String(frame)));
      await paint(95);await paint(0);await paint(frame);assert.deepEqual(await page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>node.outerHTML)),markup,'Backward seeks restore identical text markup and styles');assert.deepEqual(await page.$$eval('[data-remotion-text]',nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return[r.x,r.y,r.width,r.height];})),rects,'Backward seeks restore exact text geometry');await same(await paint(frame),screenshot,`${resolution}p backward seek at frame ${frame}`);
      await new Promise(resolve=>setTimeout(resolve,60));await same(Buffer.from(await page.screenshot()),screenshot,`${resolution}p paused frame ${frame}`);
      await writeFile(`/tmp/revline-promoted-${resolution}-preview-${frame}.png`,screenshot);
    }
    assert.deepEqual(layouts[0],layouts[1],`${resolution}p focus layout is stable during entrance`);assert.deepEqual(layouts[0],layouts[2],`${resolution}p focus layout is stable at rest`);
    assert.ok(new Set(layouts[0].words.map(word=>word[1])).size>=2,'Focus geometry fixture really wraps onto multiple lines');
    let split=timeline;for(const preset of EXPRESSIVE_TEXT_PRESETS)split=splitClip(split,preset,1.5,`${preset}-tail`);
    await save(split,resolution);await load();for(const frame of frames)await same(await paint(frame),await sharp(references.get(frame)!,{raw:{width,height,channels:3}}).png().toBuffer(),`${resolution}p persisted split phase frame ${frame}`);
    const output=join(directory,`promoted-${resolution}.mp4`);let reported=-1;
    const result=await runRenderWorker(directory,output,{fps,quality:'high'},value=>{const step=Math.floor(value.progress/25);if(step>reported){reported=step;console.log(`${resolution}p MP4: ${Math.round(value.progress)}%`);}},AbortSignal.timeout(180_000));assert.equal(result.warnings,0);await copyFile(output,`/tmp/revline-promoted-${resolution}.mp4`);
    // Lossy H.264 and Chromium font rasterization can shift glyph-edge pixels.
    // Every effect must stay below2% mean channel error in its own cell.
    const differences:Record<number,string>={};
    for(const frame of frames){
      const preview=references.get(frame)!,exported=execFileSync('ffmpeg',['-v','error','-ss',String(frame/fps),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:10*1024*1024});assert.equal(exported.length,preview.length);
      const totals=Array(8).fill(0),painted=Array(8).fill(0);
      for(let i=0;i<preview.length;i++){const pixel=Math.floor(i/3),quadrant=(pixel%width<width/2?0:1)+Math.floor(pixel/(width*height/4))*2,channel=i%3;totals[quadrant]+=Math.abs((preview[i]-preview[channel])-(exported[i]-exported[channel]));if(exported[i]>100)painted[quadrant]++;}
      for(let quadrant=0;quadrant<7;quadrant++){const mean=totals[quadrant]/(width*height/8*3);assert.ok(mean<5,`${resolution}p ${EXPRESSIVE_TEXT_PRESETS[quadrant]} frame ${frame}: preview/export ${mean}`);if(frame===84)assert.ok(painted[quadrant]>1000,`${EXPRESSIVE_TEXT_PRESETS[quadrant]} paints settled text`);}
      differences[frame]=totals.map(total=>(total/(width*height/8*3)).toFixed(3)).join('/');
    }
    for(let quadrant=0;quadrant<7;quadrant++){let changed=0;for(let i=0;i<references.get(6)!.length;i++){const pixel=Math.floor(i/3),cell=(pixel%width<width/2?0:1)+Math.floor(pixel/(width*height/4))*2;if(cell===quadrant&&references.get(6)![i]!==references.get(84)![i])changed++;}assert.ok(changed>500,`${EXPRESSIVE_TEXT_PRESETS[quadrant]} has frame-driven entrance motion`);}
    await copyFile(output,`/tmp/revline-promoted-${resolution}.mp4`);console.log(JSON.stringify({resolution,focusLines:new Set(layouts[0].words.map(word=>word[1])).size,previewExportErrors:differences}));
  }
  // Original templates and speech-timed karaoke remain production-clock compatible.
  await page.setViewport({width:1280,height:720});
  const legacy:RemotionTextPreset[]=['word-reveal','word-pop','slide-title','karaoke','neon-echo','lyric-slam','kinetic-stack'];
  for(const preset of legacy){
    const clip:Clip={id:'legacy',kind:'caption',track:1,start:0,duration:4,sourceStart:0,text:'WORDS STAY TIMED',fontSize:108,x:.5,y:.5,color:'#ffffff',background:'transparent',textTemplate:{preset,duration:4,offset:0,...(preset==='karaoke'?{wordTimings:[{start:0,end:.4},{start:1.1,end:1.5},{start:2.4,end:3.4}]}:{})}};
    const timeline:Timeline={fps,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:0,effects:0},clips:[clip]};await save(timeline,720);await load();const before=await paint(30);assert.equal(await page.$eval('[data-remotion-text]',node=>node.getAttribute('data-frame')),'30');assert.ok((await rgb(before)).some(value=>value>150),`${preset} still paints`);
    if(preset==='karaoke'){
      for(const [frame,index] of [[3,0],[30,1],[66,2]]){await paint(frame);assert.equal(await page.$$eval('[data-word-index]',nodes=>nodes.findIndex(node=>(node as HTMLElement).style.backgroundColor!=='transparent')),index,'Speech timing selects the actual active word');}
      const reference=await paint(66);await save(splitClip(timeline,'legacy',1.5,'speech-tail'),720);await load();await same(await paint(66),reference,'Speech-timed karaoke split preserves its original active word');
    }
  }
  await page.setViewport({width:600,height:1000});await page.goto(origin+'/ui.html');await page.click('#text-settings-animation-tab');await page.waitForSelector('[aria-label="Preview Chromatic split"]');
  for(const preset of EXPRESSIVE_TEXT_PRESETS){
    const label=REMOTION_TEXT_LABELS[preset],before=await page.evaluate(()=>(window as any).currentClip.textTemplate?.preset);
    await page.click(`[aria-label="Preview ${label}"]`);assert.equal(await page.evaluate(()=>(window as any).currentClip.textTemplate?.preset),before,'Preview card never applies an animation');
    await page.click(`[aria-label="Apply ${label}"]`);assert.equal(await page.evaluate(()=>(window as any).currentClip.textTemplate.preset),preset);
    assert.deepEqual(await page.$$eval('.text-animation-tuning input',nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),value:Number((node as HTMLInputElement).value)}))),[{label:'Animation strength',value:1},{label:'Reveal duration',value:.65},{label:'Text stagger',value:.07}]);
  }
  for(const [label,,target] of [['Animation strength','strength','End'],['Reveal duration','revealDuration','Home'],['Text stagger','stagger','End']]){await page.focus(`[aria-label="${label}"]`);await page.keyboard.press(target as 'Home'|'End');}
  assert.deepEqual(await page.evaluate(()=>{const clip=(window as any).currentClip;return{text:clip.text,start:clip.start,duration:clip.duration,settings:[clip.textTemplate.strength,clip.textTemplate.revealDuration,clip.textTemplate.stagger]};}),{text:'Words and timing stay intact',start:0,duration:4,settings:[2,.15,.18]});
  await page.screenshot({path:'/tmp/revline-promoted-text-controls.png'});assert.deepEqual(errors,[]);
  console.log('PASS: all7 promoted production text animations render at exact entrance/rest frames and backward seeks, preserve split phase, keep Cinematic focus line geometry stable, match actual720p+1080p MP4 pixels, retain original7/karaoke speech timings, and expose selectable/editable bounded production controls. No paid calls.');
}finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
