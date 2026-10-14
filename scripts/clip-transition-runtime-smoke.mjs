import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const sharp = createRequire(import.meta.url)('sharp'), directory = await mkdtemp(join(tmpdir(),'revline-transition-runtime-'));
const decoded = process.env.REVLINE_TRANSITION_VIDEO === '1';
if(decoded)execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=red:size=1920x1080:rate=30:duration=2','-f','lavfi','-i','color=lime:size=1920x1080:rate=30:duration=2','-f','lavfi','-i','color=blue:size=1920x1080:rate=30:duration=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6','-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0,scale=in_color_matrix=bt601:out_color_matrix=bt709[v]','-map','[v]','-map','3:a','-threads','1','-filter_complex_threads','1','-c:v','libx264','-preset','ultrafast','-c:a','aac','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-pix_fmt','yuv420p','-movflags','+faststart',join(directory,'source.mp4')]);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useRef}from'react';import{createRoot}from'react-dom/client';
import{Preview}from'./components/editor/preview';import{EditorStateProvider,useEditorState}from'./components/editor/editor-state';import{createEditorStore}from'./lib/editor/store';
const initial={fps:30,aspectRatio:'landscape',tracks:{visual:${decoded?1:2},overlay:0,audio:${decoded?1:0},effects:1},clips:[
${decoded?'':"{id:'under',kind:'image',assetId:'green',track:1,start:0,duration:4,sourceStart:0},"}
{id:'from',kind:'${decoded?'video':'image'}',assetId:'${decoded?'source':'red'}',track:${decoded?1:2},start:0,duration:2,sourceStart:${decoded?.5:0},volume:0},
{id:'to',kind:'${decoded?'video':'image'}',assetId:'${decoded?'source':'blue'}',track:${decoded?1:2},start:2,duration:2,sourceStart:${decoded?4:0},volume:0},
${decoded?"...['from','to'].map((id,index)=>({id:'audio-'+id,kind:'audio',assetId:'tone',track:1,start:index*2,duration:2,sourceStart:index?4:.5,volume:.1})),":''}
]},store=createEditorStore(initial),assets=${decoded?"[{_id:'source',kind:'video',fileName:'Owned1080p colors',width:1920,height:1080,url:location.origin+'/source.mp4'},{_id:'tone',kind:'audio',fileName:'Owned tone',url:location.origin+'/source.mp4'}]":"['red','blue','green'].map(color=>({_id:color,kind:'image',fileName:'Owned color',width:32,height:18,url:location.origin+'/'+color+'.svg'}))"};
function Fixture(){const timeline=useEditorState(state=>state.timeline),ref=useRef(null);const edit=clips=>store.getState().edit({...store.getState().timeline,clips});
window.fixture={seek:time=>ref.current.seek(time),play:()=>ref.current.play(),pause:()=>ref.current.pause(),timeline:()=>store.getState().timeline,
 add:()=>edit([...store.getState().timeline.clips,{id:'transition',kind:'effect',effectPreset:'crossfade',track:1,start:1.5,duration:1,sourceStart:0,transition:{fromClipId:'from',toClipId:'to',direction:'clockwise'}}]),
 patch:patch=>edit(store.getState().timeline.clips.map(clip=>clip.id==='transition'?{...clip,...patch}:clip)),remove:()=>edit(store.getState().timeline.clips.filter(clip=>clip.id!=='transition')),
 addBlur:()=>edit([...store.getState().timeline.clips,{id:'global-blur',kind:'effect',effectPreset:'zoom-blur',track:2,start:0,duration:4,sourceStart:0,zoomBlur:{enabled:true,amount:.15,centerX:.5,centerY:.5}}]),
 removeBlur:()=>edit(store.getState().timeline.clips.filter(clip=>clip.id!=='global-blur')),
 pairStyle:patch=>edit(store.getState().timeline.clips.map(clip=>['from','to'].includes(clip.id)?{...clip,...patch}:clip)),
 invert:()=>edit(store.getState().timeline.clips.map(clip=>clip.id==='from'?{...clip,invert:{enabled:true,amount:1}}:clip))};
return <div className="stage"><Preview ref={ref} timeline={timeline} assets={assets} time={0} muted onTime={time=>store.setState({playhead:time})} onPlaying={playing=>store.setState({playing})} onError={error=>(window.errors??=[]).push(error)}/></div>}
createRoot(document.getElementById('root')).render(<EditorStateProvider store={store}><Fixture/></EditorStateProvider>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-transition-fixture',define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1').pathname;let body;
 if(path==='/source.mp4'&&decoded){body=await readFile(join(directory,'source.mp4'));const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range??''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),body.length-1):body.length-1;res.writeHead(range?206:200,{'Content-Type':'video/mp4','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${body.length}`}:{})});return res.end(body.subarray(start,end+1));}
 if(path==='/fixture.js')body=bundle.outputFiles.find(file=>file.path.endsWith('.js')).text;
 else if(path.startsWith('/vendor/')||path.startsWith('/fonts/'))body=await readFile('public'+path).catch(()=>null);
 else if(['red','blue','green'].includes(path.slice(1,-4)))body=`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="18"><rect width="32" height="18" fill="${path.slice(1,-4)==='green'?'#00ff00':path.slice(1,-4)}"/></svg>`;
 body??='<style>body{margin:0}.stage,.preview-canvas{width:640px;height:360px;position:relative}.hyperframes-host{position:absolute;inset:0}</style><div id="root"></div><script src="/fixture.js"></script>';
 res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.svg')?'image/svg+xml':path.endsWith('.woff2')?'font/woff2':'text/html'});res.end(body);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--js-flags=--max-old-space-size=768']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function seek(time){await page.evaluate(async time=>{window.fixture.seek(time);const win=document.querySelector('hyperframes-player').iframeElement.contentWindow;await win.__revlineTransitionController?.whenReady(time);await win.__hfWaitForSeekCompletion?.();},time);await settle();}
async function pixel(label,expected){
 if(decoded)expected=await page.evaluate(()=>{
  const win=document.querySelector('hyperframes-player').iframeElement.contentWindow,doc=win.document,time=win.__timelines.revline.time();
  const color=video=>{const canvas=doc.createElement('canvas');canvas.width=1;canvas.height=1;canvas.getContext('2d').drawImage(video,video.videoWidth/2,video.videoHeight/2,1,1,0,0,1,1);return [...canvas.getContext('2d').getImageData(0,0,1,1).data];};
  const pair=doc.querySelector('.transition-pair');
  if(pair&&pair.style.display!=='none'){
   const progress=Number(pair.querySelector('[data-remotion-transition]').dataset.progress),colors=['from','to'].map(id=>color(doc.querySelector('[data-source-clip="'+id+'"]')));return [0,1,2].map(index=>Math.round(colors[0][index]*(1-progress)+colors[1][index]*progress));
  }
  return color([...doc.querySelectorAll('video')].find(video=>time>=Number(video.dataset.start)&&time<Number(video.dataset.end))).slice(0,3);
 });
 const{data,info}=await sharp(await(await page.$('.stage')).screenshot()).raw().toBuffer({resolveWithObject:true}),offset=(Math.floor(info.height/2)*info.width+Math.floor(info.width/2))*info.channels,actual=[...data.subarray(offset,offset+3)];console.log(JSON.stringify({label,actual,expected}));assert.ok(actual.every((value,index)=>Math.abs(value-expected[index])<7),label);
}
try{
 await page.setViewport({width:1000,height:700});await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.style.zIndex==='1');
 await page.evaluate(()=>{const player=document.querySelector('hyperframes-player'),doc=player.iframeElement.contentDocument;window.original={player,document:doc,sources:[...doc.querySelectorAll('[data-source-clip]')],events:{}};for(const video of doc.querySelectorAll('video')){window.original.events[video.id]={loadstart:0,emptied:0};for(const name of ['loadstart','emptied'])video.addEventListener(name,()=>window.original.events[video.id][name]++);}window.fixture.add();});
 await page.waitForFunction(()=>document.querySelector('hyperframes-player').iframeElement.contentWindow.__revlineTransitionController);
 await seek(1.75);await pixel('Incoming edge participates before authored cut',decoded?[0,191,64]:[191,0,64]);
 await seek(2);await pixel('Both neighboring scenes mix at cut',decoded?[0,128,128]:[128,0,128]);
 await seek(2.25);await pixel('Outgoing edge survives after authored cut',decoded?[0,64,191]:[64,0,191]);
 await seek(2.5);await pixel('Exact end is incoming native scene', [0,0,255]);
 await seek(1);await pixel('Backward seek restores outgoing native scene',[255,0,0]);
 for(const preset of ['spin-zoom','blur-dissolve']){await page.evaluate(preset=>window.fixture.patch({effectPreset:preset,transition:{fromClipId:'from',toClipId:'to',direction:'counter-clockwise'}}),preset);await seek(2);await pixel(preset+' mixes the real retained pair',decoded?[0,128,128]:[128,0,128]);}
 await page.evaluate(()=>window.fixture.patch({effectPreset:'crossfade',start:1.8,duration:.6}));await seek(2.04);await pixel('Asymmetric band follows full band progress',decoded?[0,153,102]:[153,0,102]);
 await page.evaluate(()=>window.fixture.addBlur());await settle();await pixel('Global FX hierarchy preserves active pair',decoded?[0,153,102]:[153,0,102]);await page.evaluate(()=>window.fixture.removeBlur());
 if(decoded){const samples=await page.evaluate(()=>{const doc=document.querySelector('hyperframes-player').iframeElement.contentDocument;return ['from','to'].map(id=>{const source=doc.querySelector('[data-source-clip="'+id+'"]');return {id,time:source.currentTime,paused:source.paused,hold:source.hasAttribute('data-revline-transition-hold')};});});assert.ok(Math.abs(samples[0].time-(.5+2-1/30))<.01,'Outgoing clamps to last retained project frame');assert.ok(Math.abs(samples[1].time-4.04)<.03,'Incoming follows authored source time');console.log(JSON.stringify({sourceSamples:samples}));}
 if(!decoded){await page.evaluate(()=>window.fixture.pairStyle({blendMode:'screen'}));await settle();await pixel('Common Screen pair blends with lowerVbackdrop',[156,255,99]);await page.evaluate(()=>window.fixture.pairStyle({blendMode:'normal',transform:{x:.5,y:.5,scale:1,rotation:0,opacity:.5},crop:{left:.1,right:.1,top:.1,bottom:.1}}));await settle();await pixel('Cropped transparent pair preserves lowerVbackdrop',[78,128,50]);await page.evaluate(()=>window.fixture.pairStyle({blendMode:'normal',transform:{x:.5,y:.5,scale:1,rotation:0,opacity:1},crop:{left:0,right:0,top:0,bottom:0}}));}
 if(decoded){
  await page.evaluate(()=>window.fixture.patch({effectPreset:'crossfade',start:1,duration:2}));await seek(1.2);
  const perf=await page.evaluate(async()=>{
   const win=document.querySelector('hyperframes-player').iframeElement.contentWindow,videos=[...win.document.querySelectorAll('video')],samples=[],av=[],clocks=[],callbacks=new Map();let running=true;
   const sample=video=>{const id=video.requestVideoFrameCallback((now,metadata)=>{if(!running)return;const t=win.__timelines.revline.time();if(t>=Number(video.dataset.start)&&t<Number(video.dataset.end)){samples.push({now,t,id:video.id,source:metadata.mediaTime});const audio=[...win.document.querySelectorAll('audio')].find(a=>t>=Number(a.dataset.start)&&t<Number(a.dataset.end));if(audio)av.push(Math.abs(audio.currentTime-video.currentTime)*1000);}sample(video);});callbacks.set(video,id);};videos.forEach(sample);
   const timer=setInterval(()=>clocks.push(win.__timelines.revline.time()),20);window.fixture.play();
   await new Promise(resolve=>setTimeout(resolve,300));window.fixture.patch({effectPreset:'spin-zoom'});
   await new Promise(resolve=>setTimeout(resolve,600));window.fixture.patch({effectPreset:'blur-dissolve'});
   await new Promise(resolve=>setTimeout(resolve,1500));window.fixture.pause();running=false;clearInterval(timer);for(const[video,id]of callbacks)video.cancelVideoFrameCallback(id);
   const gaps=samples.slice(1).map((sample,index)=>sample.now-samples[index].now).sort((a,b)=>a-b),jumps=clocks.slice(1).map((time,index)=>time-clocks[index]);return {frames:samples.length,decodedFps:samples.length/2.4,p95GapMs:gaps[Math.floor(gaps.length*.95)],maxGapMs:Math.max(...gaps),maxAvMs:Math.max(...av),maxClockJumpSeconds:Math.max(...jumps),cutSamples:samples.filter(sample=>Math.abs(sample.t-2)<.12)};
  });console.log(JSON.stringify({playback:perf}));assert.ok(perf.decodedFps>=20,'Decoded1080p transition playback sustains useful frame rate');assert.ok(perf.maxClockJumpSeconds<.25,'Transition changes do not jump the composition clock');await seek(2.04);
 }
 await page.evaluate(()=>window.fixture.remove());await settle();await pixel('Deleting transition restores current authored clip',[0,0,255]);
 await seek(1);await pixel('No stale incoming pixels after delete/backward seek',[255,0,0]);
 const retained=await page.evaluate(()=>{const player=document.querySelector('hyperframes-player'),doc=player.iframeElement.contentDocument;return {player:player===window.original.player,document:doc===window.original.document,sources:window.original.sources.every(source=>doc.getElementById(source.id)===source),events:window.original.events,audio:[...doc.querySelectorAll('audio')].map(source=>({start:source.dataset.start,duration:source.dataset.duration,sourceStart:source.dataset.mediaStart}))};});
 assert.equal(retained.player,true);assert.equal(retained.document,true);assert.equal(retained.sources,true);for(const events of Object.values(retained.events)){assert.equal(events.loadstart,0);assert.equal(events.emptied,0);}if(decoded)assert.deepEqual(retained.audio,[{start:'0',duration:'2',sourceStart:'0.5'},{start:'2',duration:'2',sourceStart:'4'}]);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors??[]),[]);console.log(JSON.stringify(retained));console.log('PASS: actual retained Preview transition creation/edit/removal, pair pixels, exact edges/backward seeks, source identity and unchanged audio mapping. '+(decoded?'Decoded1080p sources.':'Owned images.'));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
