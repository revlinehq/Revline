import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

// Default: generated long-GOP H.264 + separate audio, accelerated and repeated
// source ranges. Optional: a private captured snapshot and its already local MP4.
// No backend calls, uploads, edits, or exports. Set REVLINE_UNPATCHED_RUNTIME=1
// to verify that the upstream Play/Pause source-time bug makes this test fail.
const [snapshotPath, sourcePath] = process.argv.slice(2);
const directory = await mkdtemp(join(tmpdir(), 'revline-middle-resume-'));
let videoPath = sourcePath ? resolve(sourcePath) : join(directory, 'video.mp4');
if (!sourcePath) execFileSync('ffmpeg', ['-v','error','-f','lavfi','-i','testsrc2=size=960x540:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','28','-threads','1','-c:v','libx264','-preset','ultrafast','-g','150','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',videoPath]);
const audioPath = join(directory, 'audio.m4a');
execFileSync('ffmpeg', ['-v','error','-i',videoPath,'-vn','-c:a','copy',audioPath]);
const captured = snapshotPath ? JSON.parse(await readFile(snapshotPath, 'utf8')) : null;
const timeline = captured?.project.timeline ?? { fps:30,aspectRatio:'landscape',tracks:{visual:1,audio:1,overlay:0,effects:0},clips:[{start:0,duration:2,sourceStart:1,playbackRate:1.5},{start:2,duration:3,sourceStart:12,playbackRate:4},{start:5,duration:3,sourceStart:12,playbackRate:4}].flatMap((clip,index)=>[{...clip,id:`video-${index}`,kind:'video',assetId:'video',track:1,volume:0,linkedClipId:`audio-${index}`},{...clip,id:`audio-${index}`,kind:'audio',assetId:'audio',track:1,volume:.1,linkedClipId:`video-${index}`}]) };
const assets = (captured?.assets ?? [{_id:'video',kind:'video',width:960,height:540},{_id:'audio',kind:'audio'}]).map(({_id,kind,width,height},index)=>({_id,kind,...(width?{width,height}:{}),url:`/media/${index}`}));
const media = await Promise.all(assets.map(async asset=>{const path=asset.kind==='audio'?audioPath:videoPath;return{path,size:(await stat(path)).size,kind:asset.kind}}));
const duration = Math.max(...timeline.clips.map(clip=>clip.start+clip.duration));
const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef} from 'react';import{createRoot}from'react-dom/client';import{Preview}from'./components/editor/preview';import{EditorStateProvider}from'./components/editor/editor-state';import{createEditorStore}from'./lib/editor/store';
const timeline=${JSON.stringify(timeline)},assets=${JSON.stringify(assets)}.map(a=>({...a,url:location.origin+a.url})),store=createEditorStore(timeline);window.errors=[];
function Fixture(){const ref=useRef(null);window.fixture={play:()=>ref.current.play(),pause:()=>ref.current.pause(),seek:t=>ref.current.seek(t),store};return <EditorStateProvider store={store}><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted={false} onTime={playhead=>store.setState({playhead})} onPlaying={playing=>store.setState({playing})} onError={error=>window.errors.push(error)}/></EditorStateProvider>};createRoot(document.getElementById('root')).render(<Fixture/>);`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:join(directory,'bundle'),define:{'process.env.NODE_ENV':'"production"'}});
const server = createServer(async (request,response)=>{
 const path=new URL(request.url,'http://fixture').pathname;
 if(path==='/fixture.js'){response.writeHead(200,{'Content-Type':'text/javascript'});return response.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text)}
 const match=/^\/media\/(\d+)$/.exec(path);
 if(match){const source=media[Number(match[1])],range=/bytes=(\d+)-(\d*)/.exec(request.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),source.size-1):source.size-1;response.writeHead(range?206:200,{'Content-Type':source.kind==='audio'?'audio/mp4':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${source.size}`}:{})});return createReadStream(source.path,{start,end}).pipe(response)}
 if(path.startsWith('/vendor/')||path.startsWith('/fonts/')){try{const file=process.env.REVLINE_UNPATCHED_RUNTIME&&path==='/vendor/hyperframe.runtime.iife.js'?'node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js':'public'+path;response.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':'font/woff2'});return response.end(await readFile(file))}catch{response.writeHead(404);return response.end()}}
 response.writeHead(200,{'Content-Type':'text/html'});response.end(`<style>${bundle.outputFiles.find(file=>file.path.endsWith('.css'))?.text??''}body{margin:0}.preview-canvas{position:relative;width:640px;height:360px}.hyperframes-host{position:absolute;inset:0}</style><div id="root"></div><script src="/fixture.js"></script>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=512']});const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12_000);
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.style.zIndex==='1');
 await page.evaluate(()=>{const player=document.querySelector('hyperframes-player'),doc=player.iframeElement.contentDocument;window.replay={player,doc,frames:[],clock:()=>{const t=doc.defaultView.__timelines.revline;return(t.__hfReal??t).time()}};for(const video of doc.querySelectorAll('video'))video.requestVideoFrameCallback(function next(now,frame){const clock=window.replay.clock();if(clock>=Number(video.dataset.start)&&clock<Number(video.dataset.end))window.replay.frames.push({clock,source:frame.mediaTime});video.requestVideoFrameCallback(next)})});
 const targets=captured&&duration>13?[0,8,12,4,8,.5,12]:[0,3.5,6.5,1,4,6];const measurements=[];
 for(const target of targets){
  await page.evaluate(target=>{window.fixture.pause();window.fixture.seek(target);window.replay.frames=[];window.fixture.play()},target);
  await new Promise(resolve=>setTimeout(resolve,750));
  const sample=await page.evaluate(target=>{const{player,doc,clock,frames}=window.replay,time=clock();return{target,time,frames:frames.length,samePlayer:player===document.querySelector('hyperframes-player'),media:[...doc.querySelectorAll('video,audio')].filter(n=>time>=Number(n.dataset.start)&&time<Number(n.dataset.end)).map(n=>({kind:n.tagName,time:n.currentTime,ready:n.readyState,seeking:n.seeking,paused:n.paused,rate:Number(n.dataset.playbackRate??1)}))}},target);
  measurements.push({target,advance:+(sample.time-target).toFixed(3),frames:sample.frames});
  assert.ok(sample.time>target+.35,`Middle seek ${target}s must advance promptly: ${JSON.stringify(sample)}`);assert.ok(sample.frames>=3,'Native video presents decoded frames after a seek');assert.ok(sample.samePlayer,'Seek/resume retains the player and native decoders');
  const video=sample.media.find(n=>n.kind==='VIDEO'),audio=sample.media.find(n=>n.kind==='AUDIO');if(video&&audio)assert.ok(Math.abs(video.time-audio.time)/video.rate<.08,'Accelerated linked A/V stays synchronized');
 }
 const target=targets[1];
 const intended=await page.evaluate(target=>{window.fixture.pause();window.fixture.seek(target+.1);window.fixture.play();const intended=window.fixture.store.getState().playing;window.fixture.pause();return intended},target);
 assert.equal(intended,true,'Pending native decode still exposes Play intent so Pause can cancel it');
 await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await page.evaluate(()=>window.fixture.store.getState().playing),false,'Completing a decoder seek cannot undo explicit Pause');
 await page.evaluate(target=>{window.fixture.seek(target);window.fixture.play();window.fixture.seek(target+.2)},target);await new Promise(resolve=>setTimeout(resolve,300));assert.equal(await page.evaluate(()=>window.fixture.store.getState().playing),false,'A newer seek cancels obsolete pending Play');assert.ok(Math.abs(await page.evaluate(()=>window.replay.clock())-(target+.2))<1/timeline.fps,'The latest paused seek wins');

 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);console.log('PASS: middle seek/Play, repeated source ranges, 1.5x/4x A/V sync, retained decoders, Pause and newer-seek cancellation.',measurements);
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
