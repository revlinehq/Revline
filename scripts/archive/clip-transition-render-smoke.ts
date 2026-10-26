import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
import { generateComposition } from '../../lib/editor/composition';
import type { Clip, Timeline } from '../../lib/editor/types';
import { runRenderWorker } from '../../lib/server/render-worker';

async function main(){
 const sharp=createRequire(join(process.cwd(),'package.json'))('sharp'), directory=await mkdtemp(join(tmpdir(),'revline-transition-render-'));
 const server=createServer(async(request,response)=>{const path=new URL(request.url!,'http://127.0.0.1').pathname.slice(1)||'index.html';if(!['index.html','source.mp4','gsap.min.js','visual-effects.js','remotion-text.js','remotion-transitions.js','font.woff2'].includes(path)){response.writeHead(404).end();return;}const bytes=await readFile(join(directory,path)),range=/bytes=(\d+)-(\d*)/.exec(request.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;response.writeHead(range?206:200,{'Content-Type':path.endsWith('.mp4')?'video/mp4':path.endsWith('.js')?'text/javascript':path.endsWith('.woff2')?'font/woff2':'text/html','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});response.end(bytes.subarray(start,end+1));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=768']});
 try{
  execFileSync('ffmpeg',['-v','error',...['red','yellow','lime','blue'].flatMap(color=>['-f','lavfi','-i',`color=${color}:size=320x180:rate=24:duration=1`]),'-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=4','-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0,scale=in_color_matrix=bt601:out_color_matrix=bt709[v]','-map','[v]','-map','4:a','-threads','1','-filter_complex_threads','1','-c:v','libx264','-preset','ultrafast','-g','24','-keyint_min','24','-c:a','aac','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-pix_fmt','yuv420p','-movflags','+faststart',join(directory,'source.mp4')]);
  for(const name of ['gsap.min.js','visual-effects.js','remotion-text.js','remotion-transitions.js'])await copyFile('public/vendor/'+name,join(directory,name));await copyFile('public/fonts/space-grotesk-latin.woff2',join(directory,'font.woff2'));
  const clips:Clip[]=[];
  for(const [index,preset]of(['crossfade','spin-zoom','blur-dissolve']as const).entries()){
   const start=index*2,from='from-'+index,to='to-'+index;
   clips.push({id:from,kind:'video',assetId:'source',track:1,start,duration:1,sourceStart:.25,volume:0,...(index===0?{invert:{enabled:true,amount:1}}:{})},{id:to,kind:'video',assetId:'source',track:1,start:start+1,duration:1,sourceStart:2.5,volume:0},{id:'transition-'+index,kind:'effect',effectPreset:preset,track:1,start:start+.5,duration:1,sourceStart:0,transition:{fromClipId:from,toClipId:to,direction:'clockwise'}},...[[start,.25],[start+1,2.5]].map(([start,sourceStart],audioIndex)=>({id:'audio-'+index+'-'+audioIndex,kind:'audio' as const,assetId:'tone',track:1,start,duration:1,sourceStart,volume:.1})));
  }
  const timeline:Timeline={fps:24,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:1},clips};
  await writeFile(join(directory,'index.html'),generateComposition(timeline,[{_id:'source',kind:'video',fileName:'Owned source colors',width:320,height:180,url:'./source.mp4'},{_id:'tone',kind:'audio',fileName:'Owned source tone',url:'./source.mp4'}],{resolution:720,gsapUrl:'./gsap.min.js',visualEffectsUrl:'./visual-effects.js',remotionTextUrl:'./remotion-text.js',remotionTransitionsUrl:'./remotion-transitions.js',fontUrl:'./font.woff2'}));
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',error=>errors.push(error instanceof Error?error.message:String(error)));await page.setViewport({width:1280,height:720});await page.goto('http://127.0.0.1:'+(server.address()as{port:number}).port,{waitUntil:'networkidle0'});
  await page.evaluate('window.__name = value => value');
  const samples=[.75,1,1.25,1.5,3,5],references:Buffer[]=[];
  for(const time of samples){
   await page.evaluate(async(time)=>{const host=window as unknown as {__timelines:{revline:{seek(time:number):void}};__revlineTransitionController:{whenReady(time:number):Promise<void>}};const videos=Array.from(document.querySelectorAll<HTMLVideoElement>('video'));for(const video of videos){const start=Number(video.dataset.start),duration=Number(video.dataset.duration);video.style.visibility=time>=start&&time<start+duration?'visible':'hidden';video.currentTime=Number(video.dataset.mediaStart)+Math.max(0,Math.min(duration-1/24,time-start));}await Promise.all(videos.map(video=>new Promise<void>(resolve=>{const check=()=>{if(video.readyState>=2&&!video.seeking){video.removeEventListener('seeked',check);resolve();}};video.addEventListener('seeked',check);check();})));host.__timelines.revline.seek(time);await host.__revlineTransitionController.whenReady(time);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},time);
   references.push(await sharp(await page.screenshot()).removeAlpha().raw().toBuffer());
  }
  assert.deepEqual(errors,[]);await browser.close();
  const output=join(directory,'output.mp4'),result=await runRenderWorker(directory,output,{fps:24,quality:'high'},()=>{},AbortSignal.timeout(150_000));assert.equal(result.warnings,0);
  const differences=[];
  for(const[index,time]of samples.entries()){const pixels=execFileSync('ffmpeg',['-v','error','-ss',String(time),'-i',output,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:4*1024*1024});assert.equal(pixels.length,references[index].length);let sum=0;for(let offset=0;offset<pixels.length;offset++)sum+=Math.abs(pixels[offset]-references[index][offset]);const error=sum/pixels.length;differences.push({time,meanRgbError:Number(error.toFixed(2)),center:[...pixels.subarray((360*1280+640)*3,(360*1280+640)*3+3)]});assert.ok(error<12,'Preview/export retained-pair difference at '+time+': '+error.toFixed(2));}
  const streams=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames:format=duration','-of','json',output],{encoding:'utf8'}));assert.ok(streams.streams.some((stream:{codec_type:string})=>stream.codec_type==='audio'),'Paired authored audio is exported');assert.equal(Number(streams.format.duration),6);console.log(JSON.stringify({differences,streams}));console.log('PASS: actual720p MP4 Crossfade/Spin zoom/Blur dissolve matches retained native source holds before/after cuts and shared browser presentation; authored6s duration/audio preserved, zero warnings. Owned synthetic source only.');
 }finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
