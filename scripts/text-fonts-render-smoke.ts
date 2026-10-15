import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { TEXT_FONTS } from '../lib/editor/text-fonts';
import type { Timeline } from '../lib/editor/types';
import { prepareComposition, writeComposition } from '../lib/server/prepare-composition';
import { runRenderWorker } from '../lib/server/render-worker';

async function main(){
  const directory=await mkdtemp(join(tmpdir(),'revline-text-fonts-'));
  const files=new Set(['index.html','ui.html','ui.js','ui.css','gsap.min.js','visual-effects.js','remotion-runtime.js',...TEXT_FONTS.map(font=>font.fileName)]);
  const server=createServer(async(request,response)=>{
    const path=new URL(request.url??'/','http://127.0.0.1').pathname,name=path.startsWith('/fonts/')?path.slice(7):path.slice(1)||'index.html';
    if(!files.has(name)){response.writeHead(404).end();return;}
    try{response.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.ttf')?'font/ttf':name.endsWith('.woff2')?'font/woff2':'text/html');response.end(await readFile(join(directory,name)));}catch{response.writeHead(404).end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser:Awaited<ReturnType<typeof puppeteer.launch>>|undefined;
  try{
    const timeline:Timeline={fps:24,aspectRatio:'landscape',tracks:{visual:12,overlay:0,audio:0,effects:0},clips:TEXT_FONTS.map((font,index)=>({id:font.id,kind:'graphic',track:index+1,start:0,duration:1.5,sourceStart:0,text:'Hero Type 123',fontFamily:font.id,fontSize:60,color:'#ffffff',background:'transparent',x:(index%3+.5)/3,y:(Math.floor(index/3)+.5)/4,...(index%2?{textTemplate:{preset:'word-reveal' as const,duration:1.5,offset:0}}:{})}))};
    await prepareComposition(directory,timeline,[],'http://127.0.0.1',AbortSignal.timeout(10_000));
    await writeComposition(directory,timeline,[],{},720,24);
    const ui=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TextEditingControls}from'./components/editor/text-editing-controls';import{TextFontStyles}from'./components/editor/text-font-styles';function Fixture(){const[clip,setClip]=useState({id:'font-ui',kind:'graphic',track:1,start:0,duration:2,sourceStart:0,text:'Keep my exact words',fontFamily:'space-grotesk',fontSize:60});window.currentClip=clip;return <><TextFontStyles/><TextEditingControls clip={clip} onChange={patch=>setClip(previous=>({...previous,...patch}))}/></>};createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',outdir:directory,define:{'process.env.NODE_ENV':'"production"'}});
    await writeFile(join(directory,'ui.js'),ui.outputFiles.find(file=>file.path.endsWith('.js'))!.text);await writeFile(join(directory,'ui.css'),ui.outputFiles.find(file=>file.path.endsWith('.css'))!.text);
    await writeFile(join(directory,'ui.html'),'<link rel="stylesheet" href="/ui.css"><style>body{background:#181818;color:#eee;font:13px Arial}#root{width:320px}</style><div id="root"></div><script src="/ui.js"></script>');
    browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error instanceof Error?error.message:String(error)));
    const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    await page.setRequestInterception(true);page.on('request',request=>{if(new URL(request.url()).origin===origin)void request.continue();else{errors.push(`Unexpected remote request: ${request.url()}`);void request.abort();}});
    await page.setViewport({width:1280,height:720});await page.goto(origin,{waitUntil:'networkidle0'});
    const faces=await page.evaluate(async fonts=>{await Promise.all(fonts.map(font=>document.fonts.load(`${font.weight} 40px "${font.family}"`)));await document.fonts.ready;return fonts.map(font=>{const context=document.createElement('canvas').getContext('2d')!;context.font=`${font.weight} 40px "${font.family}",sans-serif`;const width=context.measureText('Hero Type 123').width;context.font=`${font.weight} 40px sans-serif`;const fallback=context.measureText('Hero Type 123').width;return{id:font.id,loaded:[...document.fonts].some(face=>face.family.replaceAll('"','').replaceAll("'",'')===font.family&&face.status==='loaded'),width,fallback};});},TEXT_FONTS);
    for(const face of faces){assert.equal(face.loaded,true,`${face.id} loads its real local font`);assert.ok(Math.abs(face.width-face.fallback)>1,`${face.id} paints its own glyph metrics instead of the fallback`);}
    await page.evaluate(()=>{(window as any).__timelines.revline.seek(1,false);});
    for(const font of TEXT_FONTS)assert.ok((await page.$eval(`[data-text-clip="${font.id}"]`,node=>getComputedStyle(node).fontFamily)).includes(font.family),`${font.id} uses its selected family`);
    const preview=Buffer.from(await page.screenshot({path:'/tmp/revline-text-fonts-preview.png'})),reference=await sharp(preview).removeAlpha().raw().toBuffer();
    const output=join(directory,'fonts.mp4');const result=await runRenderWorker(directory,output,{fps:24,quality:'high'},()=>{},AbortSignal.timeout(120_000));assert.equal(result.warnings,0);
    const exported=execFileSync('ffmpeg',['-v','error','-ss','1','-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:10*1024*1024}),difference=Array(12).fill(0),painted=Array(12).fill(0);
    assert.equal(exported.length,reference.length);
    for(let i=0;i<reference.length;i++){const pixel=Math.floor(i/3),cell=Math.min(2,Math.floor((pixel%1280)/(1280/3)))+Math.floor(pixel/(1280*720/4))*3;difference[cell]+=Math.abs(reference[i]-exported[i]);if(exported[i]>100)painted[cell]++;}
    for(let index=0;index<TEXT_FONTS.length;index++){assert.ok(painted[index]>1000,`${TEXT_FONTS[index].id} appears in actual MP4`);assert.ok(difference[index]/(1280*720/12*3)<5,`${TEXT_FONTS[index].id} preview/export glyph pixels agree`);}
    await copyFile(output,'/tmp/revline-text-fonts.mp4');
    await page.setViewport({width:600,height:900});await page.goto(origin+'/ui.html',{waitUntil:'networkidle0'});
    for(const font of TEXT_FONTS){await page.click('[aria-label="Text font"]');await page.waitForSelector(`[role="menuitemradio"][data-value="${font.id}"]`);assert.equal(await page.$$eval('[role="menuitemradio"]',nodes=>nodes.length),TEXT_FONTS.length);await page.click(`[role="menuitemradio"][data-value="${font.id}"]`);assert.deepEqual(await page.evaluate(()=>{const c=(window as any).currentClip;return{fontFamily:c.fontFamily,text:c.text,start:c.start,duration:c.duration};}),{fontFamily:font.id,text:'Keep my exact words',start:0,duration:2});}
    assert.deepEqual(errors,[]);console.log(JSON.stringify({fonts:faces.map(face=>({id:face.id,width:face.width})),previewExportMeanErrors:difference.map(value=>(value/(1280*720/12*3)).toFixed(3))}));
    console.log('PASS: all12 bundled font files load and paint distinct real glyphs, selectable fonts retain exact text/timing, production preparation packages every font locally, and actual720p MP4 matches preview. No remote runtime font requests or paid calls.');
  }finally{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
