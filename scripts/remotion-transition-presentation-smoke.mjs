import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';

const packageInfo=JSON.parse(await readFile('node_modules/@remotion/transitions/package.json','utf8'));
assert.equal(packageInfo.version,'4.0.535','Exercise the exact installed Remotion package');
const directory=await mkdtemp(join(tmpdir(),'revline-transition-presentations-'));
execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','color=c=red:s=64x64:r=24:d=1','-c:v','libx264','-pix_fmt','yuv420p','-y',join(directory,'source.mp4')]);
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import {createPresentation} from './lib/editor/remotion-transition-presentation';
const host=document.getElementById('presentation'),bridge=createPresentation(host);
const from=document.createElement('div'),to=document.createElement('div');
from.dataset.scene='from';to.dataset.scene='to';
const fill={position:'absolute',inset:'0',width:'100%',height:'100%'};
Object.assign(from.style,fill,{background:'#ff0000'});Object.assign(to.style,fill,{background:'#0000ff'});
bridge.fromSlot.append(from);bridge.toSlot.append(to);
window.bridge=bridge;window.from=from;window.to=to;window.host=host;
window.paint=(preset,progress,direction='clockwise',cropped=false)=>{
 Object.assign(from.style,{width:cropped?'75%':'100%'});
 Object.assign(to.style,{left:cropped?'25%':'0',width:cropped?'75%':'100%',opacity:cropped?'0.5':'1'});
 bridge.render({preset,direction,progress,durationInFrames:18,outputHeight:64});
};
window.paintAt=(start,duration,time)=>bridge.render({preset:'crossfade',direction:'clockwise',progress:(time-start)/duration,durationInFrames:Math.round(duration*30)});
window.mediaEvents={loadstart:0,emptied:0};
const video=document.createElement('video');Object.assign(video.style,fill);video.muted=true;video.preload='auto';video.src='/source.mp4';
video.addEventListener('loadstart',()=>window.mediaEvents.loadstart++);video.addEventListener('emptied',()=>window.mediaEvents.emptied++);
const media=document.createElement('div');Object.assign(media.style,fill);media.append(video);document.getElementById('retained-source').append(media);
window.video=video;window.media=media;
window.adoptVideo=()=>{bridge.fromSlot.replaceChildren();if(typeof bridge.fromSlot.moveBefore==='function')bridge.fromSlot.moveBefore(media,null);else bridge.fromSlot.append(media)};
window.restoreVideo=()=>{const target=document.getElementById('retained-source');if(typeof target.moveBefore==='function')target.moveBefore(media,null);else target.append(media)};
window.paint('crossfade',0);
`},bundle:true,format:'iife',platform:'browser',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}});
const server=createServer(async(request,response)=>{
 if(request.url==='/fixture.js'){response.setHeader('Content-Type','text/javascript');response.end(bundle.outputFiles[0].text)}
 else if(request.url==='/source.mp4'){
  const bytes=await readFile(join(directory,'source.mp4'));response.setHeader('Content-Type','video/mp4');response.setHeader('Accept-Ranges','bytes');
  const range=request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
  if(range){const start=Number(range[1]),end=range[2]?Math.min(bytes.length-1,Number(range[2])):bytes.length-1;response.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});response.end(bytes.subarray(start,end+1))}
  else{response.setHeader('Content-Length',bytes.length);response.end(bytes)}
 }
 else{response.setHeader('Content-Type','text/html');response.end('<html><body style="margin:0;background:#00ff00"><div id="presentation" style="position:relative;width:64px;height:64px;background:transparent"></div><div id="retained-source" style="position:absolute;left:100px;top:0;width:64px;height:64px"></div><script src="/fixture.js"></script></body></html>')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--js-flags=--max-old-space-size=512']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function pixels(){await flush();const png=Buffer.from(await page.screenshot({clip:{x:0,y:0,width:64,height:64}}));return execFileSync('ffmpeg',['-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{input:png,maxBuffer:64*64*3+16384})}
function color(frame,x,y){return [...frame.subarray((y*64+x)*3,(y*64+x)*3+3)]}
function close(actual,expected,label){assert.ok(actual.every((value,index)=>Math.abs(value-expected[index])<=2),label+': '+JSON.stringify({actual,expected}))}
const directions=['clockwise','counter-clockwise'];
try{
 await page.setViewport({width:180,height:100});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('[data-remotion-transition]');
 for(const preset of ['crossfade','spin-zoom','blur-dissolve']){
  await page.evaluate(preset=>window.paint(preset,0),preset);close(color(await pixels(),32,32),[255,0,0],preset+' starts on outgoing');
  await page.evaluate(preset=>window.paint(preset,1),preset);close(color(await pixels(),32,32),[0,0,255],preset+' finishes on incoming');
  if(preset==='crossfade'){
   await page.evaluate(()=>window.paint('crossfade',.5));const half=await pixels();close(color(half,32,32),[128,0,128],'Crossfade conserves opaque red/blue weights without underlayer bleed');
   await page.evaluate(()=>{window.paint('crossfade',1);window.paint('crossfade',0);window.paint('crossfade',.5)});assert.ok((await pixels()).equals(half),'Backward seeking produces identical Crossfade pixels');
  }else for(const direction of directions){
   await page.evaluate(({preset,direction})=>window.paint(preset,.5,direction),{preset,direction});const partial=await pixels();
   close(color(partial,32,32),[128,0,128],preset+' '+direction+' preserves weighted scene colors');
   await page.evaluate(({preset,direction})=>{window.paint(preset,1,direction);window.paint(preset,0,direction);window.paint(preset,.5,direction)},{preset,direction});assert.ok((await pixels()).equals(partial),preset+' '+direction+' backward seek is deterministic');
  }
 }
 // Different cropped/alpha scenes must leave the correctly weighted original underlayer.
 await page.evaluate(()=>window.paint('crossfade',.5,'clockwise',true));const crop=await pixels();
 close(color(crop,8,32),[128,128,0],'Outgoing-only crop fades to its original underlayer');
 close(color(crop,32,32),[128,64,64],'Overlapping cropped scenes sum premultiplied alpha exactly');
 close(color(crop,56,32),[0,191,64],'Half-transparent incoming-only crop keeps 75% underlayer');
 await page.evaluate(()=>window.paint('crossfade',1,'clockwise',true));const end=await pixels();
 close(color(end,8,32),[0,255,0],'No outgoing pixels remain behind transparent incoming crop');close(color(end,32,32),[0,128,128],'Incoming transparency preserved at endpoint');
 await page.evaluate(()=>{window.paint('crossfade',0);window.paintAt(4.7,.6,5)});close(color(await pixels(),32,32),[128,0,128],'Symmetric band midpoint');
 await page.evaluate(()=>window.paintAt(4.8,.5,5));close(color(await pixels(),32,32),[153,0,102],'Asymmetric band preserves clock progress at cut');

 // The custom styles run on the real Remotion scene wrappers, not on retained media.
 await page.evaluate(()=>window.paint('spin-zoom',.5,'clockwise'));
 const spin=await page.evaluate(()=>{const a=window.bridge.fromSlot.parentElement.parentElement,b=window.bridge.toSlot.parentElement.parentElement;return {from:a.style.transform,to:b.style.transform,mediaFrom:window.from.style.transform,mediaTo:window.to.style.transform}});
 assert.deepEqual(spin,{from:'rotate(9deg) scale(1.275)',to:'rotate(-9deg) scale(1.275)',mediaFrom:'',mediaTo:''});
 await page.evaluate(()=>window.paint('spin-zoom',.5,'counter-clockwise'));
 assert.equal(await page.evaluate(()=>window.bridge.fromSlot.parentElement.parentElement.style.transform),'rotate(-9deg) scale(1.275)');
 // Asymmetric striped scenes make both rotation directions and blur visible in actual pixels.
 await page.evaluate(()=>{window.from.style.background='repeating-linear-gradient(90deg,#ff0000 0 4px,#ffffff 4px 8px)';window.to.style.background='repeating-linear-gradient(0deg,#0000ff 0 4px,#ffffff 4px 8px)';window.paint('crossfade',.5)});
 const sharp=await pixels();
 await page.evaluate(()=>window.paint('spin-zoom',.5,'clockwise'));const clockwise=await pixels();
 await page.evaluate(()=>window.paint('spin-zoom',.5,'counter-clockwise'));const counter=await pixels();
 assert.ok(!clockwise.equals(sharp)&&!counter.equals(clockwise),'Spin renders distinct rotated/zoomed pixels in both directions');
 await page.evaluate(()=>window.bridge.render({preset:'blur-dissolve',direction:'clockwise',progress:.5,durationInFrames:18,outputHeight:720}));const soft=await pixels();
 assert.ok(!soft.equals(sharp),'Blur dissolve actually softens scene pixels');
 assert.equal(await page.evaluate(()=>window.bridge.toSlot.parentElement.parentElement.style.filter),'blur(6.66667px)');
 await page.evaluate(()=>{window.from.style.background='#ff0000';window.to.style.background='#0000ff'});
 // Cropped transparent scenes keep the original lower track for every presentation.
 for(const preset of ['spin-zoom','blur-dissolve']){
  await page.evaluate(preset=>window.paint(preset,.5,'clockwise',true),preset);const frame=await pixels();
  close(color(frame,32,32),[128,64,64],preset+' cropped overlap retains premultiplied alpha');
  await page.evaluate(preset=>window.paint(preset,1,'clockwise',true),preset);const complete=await pixels();
  close(color(complete,8,32),[0,255,0],preset+' endpoint removes outgoing crop');
  close(color(complete,32,32),[0,128,128],preset+' endpoint restores incoming alpha');
 }

 // A real already-decoded native video survives every progress/direction/preset change.
 await page.waitForFunction(()=>window.video.readyState>=2);await page.evaluate(()=>{window.video.currentTime=.25});await page.waitForFunction(()=>!window.video.seeking&&window.video.readyState>=2&&Math.abs(window.video.currentTime-.25)<.01);
 await page.evaluate(()=>{window.adoptVideo();window.before={time:window.video.currentTime,src:window.video.currentSrc,events:{...window.mediaEvents},fromSlot:window.bridge.fromSlot,toSlot:window.bridge.toSlot}});
 for(const preset of ['crossfade','spin-zoom','blur-dissolve','crossfade'])for(const direction of directions)await page.evaluate(({preset,direction})=>window.bridge.render({preset,direction,progress:.5,durationInFrames:18}),{preset,direction});
 await flush();
 assert.deepEqual(await page.evaluate(()=>({sameVideo:window.bridge.fromSlot.querySelector('video')===window.video,sameFrom:window.bridge.fromSlot===window.before.fromSlot,sameTo:window.bridge.toSlot===window.before.toSlot,connected:window.video.isConnected,time:window.video.currentTime,sourceUnchanged:window.video.currentSrc===window.before.src,eventsUnchanged:JSON.stringify(window.mediaEvents)===JSON.stringify(window.before.events),hasPlayer:!!document.querySelector('hyperframes-player,remotion-player')})),{sameVideo:true,sameFrom:true,sameTo:true,connected:true,time:.25,sourceUnchanged:true,eventsUnchanged:true,hasPlayer:false});
 await page.evaluate(()=>window.bridge.dispose());await flush();
 assert.equal(await page.evaluate(()=>window.video.isConnected&&window.bridge.fromSlot.contains(window.video)),true,'Dispose rescues native children before React unmounts');
 await page.evaluate(()=>window.restoreVideo());await flush();
 assert.deepEqual(await page.evaluate(()=>({parentRestored:document.getElementById('retained-source').contains(window.video),time:window.video.currentTime,events:window.mediaEvents})),{parentRestored:true,time:.25,events:{loadstart:1,emptied:0}});
 assert.deepEqual(errors,[]);
 console.log('PASS: actual Remotion4.0.535 fade presentation with Crossfade, Spin zoom and Blur dissolve styles; two spin directions, exact endpoints and deterministic backward seeks; symmetric/asymmetric clocks and alpha/crop weights; native decoded video/slots retained without load/empty events or a new player.');
}catch(error){console.error('Native source state',await page.evaluate(()=>({time:window.video?.currentTime,readyState:window.video?.readyState,seeking:window.video?.seeking,duration:window.video?.duration,seekable:window.video?.seekable.length,mediaError:window.video?.error?.code,events:window.mediaEvents,moveBefore:typeof window.bridge?.fromSlot.moveBefore})));throw error}
finally{await browser.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})}
