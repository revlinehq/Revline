import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

// Actual editor shell and F1 preview, with deterministic YouTube delivery and isolated navigation.
const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {TooltipProvider} from './components/ui/tooltip';import {ProductDemoPreview} from './components/landing/editor-demo-preview';import './components/workspace/shared.css';import './components/workspace/workspace-pages.css';import './app/landing.css';
const root=createRoot(document.getElementById('root'));window.unmountDemo=()=>root.unmount();root.render(<TooltipProvider><ProductDemoPreview/></TooltipProvider>);
`},bundle:true,splitting:true,format:'esm',platform:'browser',jsx:'automatic',write:false,outdir:'/tmp/revline-landing-loading',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'local-boundaries',setup(builder){const stubs={
  'next/navigation':"const params=new URLSearchParams();export const useSearchParams=()=>params;",
  '@/components/workspace/workspace-nav':"import React from 'react';import {PrimaryButton} from './components/workspace/primary-button';export function WorkspaceNav(p){return <header className='workspace-nav'><span>{p.title}</span><div className='workspace-nav-actions'><button aria-label='Undo' disabled={!p.canUndo} onClick={p.onUndo}>Undo</button><button aria-label='Redo' disabled={!p.canRedo} onClick={p.onRedo}>Redo</button><PrimaryButton size='compact' onClick={p.onExport}>Export</PrimaryButton></div></header>}"
};builder.onResolve({filter:/.*/},args=>Object.hasOwn(stubs,args.path)?{path:args.path,namespace:'fixture'}:undefined);builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const files = new Map(bundle.outputFiles.map(file=>['/'+file.path.split('/').at(-1),file.contents]));
const entry = bundle.outputFiles.find(file=>file.path.endsWith('/stdin.js')).path.split('/').at(-1);
const css = bundle.outputFiles.find(file=>file.path.endsWith('.css')).path.split('/').at(-1);
const requests=[];
const server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://fixture').pathname;requests.push({path,method:req.method});
  const body=path==='/'?`<html><link rel="stylesheet" href="/${css}"><style>body{margin:0;font:12px Arial}button,input,textarea{font:inherit}button{border:0;background:none}.landing{--font-inter:Arial;--font-space-grotesk:Arial;width:calc(100% - 40px);max-width:1240px;margin:20px auto}#after{height:1400px}</style><main id="root" class="landing"></main><div id="after"></div><script type="module" src="/${entry}"></script>`:files.get(path)??await readFile('public'+path);
  const mime=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.webp')?'image/webp':path.endsWith('.mp4')?'video/mp4':path.endsWith('.woff2')?'font/woff2':'text/html';
  if(mime==='video/mp4'&&req.headers.range){const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range),start=Number(match[1]),end=Math.min(body.length-1,match[2]?Number(match[2]):body.length-1);res.writeHead(206,{'Content-Type':mime,'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${body.length}`,'Content-Length':end-start+1}).end(body.subarray(start,end+1));return;}
  res.writeHead(200,{'Content-Type':mime,'Content-Length':Buffer.byteLength(body)}).end(body);
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
const videoId=(await readFile('components/landing/f1-preview.tsx','utf8')).match(/export const F1_VIDEO_ID = '([^']+)'/)[1];
const duration=Number((await readFile('components/landing/demo-story.ts','utf8')).match(/duration: ([\d.]+)/)[1]);
const poster='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#151515"/><text x="640" y="360" fill="white" text-anchor="middle" font-family="Arial" font-size="50">Featured Formula 1 edit</text></svg>';
// Only delivery is stubbed: the real component creates, controls and destroys this player.
const youtubeApi=`
window.youtubeFixture={players:[],destroyed:0};
window.YT={Player:class {
  constructor(element,options){
    this.options=options;this.time=0;this.started=0;this.paused=true;this.muted=false;
    this.iframe=document.createElement('iframe');this.iframe.width=options.width;this.iframe.height=options.height;
    this.iframe.title='Featured Formula 1 edit';this.iframe.allow='autoplay; encrypted-media';
    this.iframe.src=options.host+'/embed/'+options.videoId+'?'+new URLSearchParams(options.playerVars);
    element.replaceWith(this.iframe);window.youtubeFixture.players.push(this);
    this.readyTimer=setTimeout(()=>options.events.onReady({target:this}),0);
  }
  playVideo(){if(!this.paused)return;this.started=performance.now();this.paused=false;}
  pauseVideo(){this.time=this.getCurrentTime();this.paused=true;}
  mute(){this.muted=true;}
  getCurrentTime(){return (this.time+(this.paused?0:(performance.now()-this.started)/1000))%${duration};}
  getPlayerState(){return this.paused?2:1;}
  destroy(){clearTimeout(this.readyTimer);this.pauseVideo();this.iframe.remove();window.youtubeFixture.destroyed++;}
}};
window.onYouTubeIframeAPIReady?.();
`;
try{
  const page=await browser.newPage(),errors=[],unexpectedExternal=[],mocked=[];page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin===origin)return void request.continue();
    if(url.href==='https://www.youtube.com/iframe_api'){mocked.push(url.href);return void request.respond({status:200,contentType:'text/javascript',body:youtubeApi});}
    if(url.origin==='https://www.youtube-nocookie.com'&&url.pathname==='/embed/'+videoId){mocked.push(url.href);return void request.respond({status:200,contentType:'text/html',body:'<html style="height:100%;background:#151515;color:white;font:24px Arial"><body style="height:100%;margin:0;display:grid;place-items:center">Featured Formula 1 edit</body></html>'});}
    if(url.href==='https://i.ytimg.com/vi/'+videoId+'/hqdefault.jpg'){mocked.push(url.href);return void request.respond({status:200,contentType:'image/svg+xml',body:poster});}
    if(/^https?:$/.test(url.protocol)){unexpectedExternal.push(url.href);return void request.abort();}
    void request.continue();
  });
  const playback=()=>page.evaluate(()=>{const player=window.youtubeFixture.players[0];return {time:player.getCurrentTime(),paused:player.paused,muted:player.muted,count:window.youtubeFixture.players.length,samePlayer:player===window.firstLandingPlayer,sameFrame:player.iframe===window.firstLandingFrame};});
  await page.setViewport({width:1280,height:900});await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('.landing-product-demo[data-story-stage="0"] textarea')?.value.length>3);
  const typed=await page.$eval('.landing-product-demo textarea',node=>node.value);
  await page.waitForFunction(previous=>document.querySelector('.landing-product-demo textarea')?.value.length>previous.length,{},typed);
  const configuration=await page.evaluate(()=>{
    window.story=[];
    window.firstLandingPlayer=window.youtubeFixture.players[0];
    window.firstLandingFrame=window.firstLandingPlayer.iframe;
    window.storyObserver=new MutationObserver(()=>{const root=document.querySelector('.landing-product-demo');window.story.push({stage:root.dataset.storyStage,clips:root.querySelectorAll('.clip-video').length,titles:root.querySelectorAll('.clip-graphic').length,prompt:root.querySelector('textarea')?.value??'',reply:root.querySelector('.landing-demo-reply')?.textContent??null});});
    window.storyObserver.observe(document.querySelector('.landing-product-demo'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-story-stage']});
    const {host,videoId,playerVars}=window.firstLandingPlayer.options;return {host,videoId,playerVars};
  });
  assert.equal(configuration.host,'https://www.youtube-nocookie.com');assert.equal(configuration.videoId,videoId);
  for(const [key,value] of Object.entries({autoplay:1,mute:1,controls:0,playsinline:1,loop:1,playlist:videoId,origin}))assert.equal(configuration.playerVars[key],value,'YouTube player option '+key);
  const initial=await playback();assert.equal(initial.paused,false,'Featured film autoplays before the editing story');assert.equal(initial.muted,true);assert.equal(initial.count,1);
  assert.equal(await page.$('hyperframes-player'),null,'The replaced composition player is not mounted underneath the film');
  assert.equal(await page.$eval('.landing-demo-credit a',node=>node.href),'https://www.youtube.com/watch?v='+videoId);
  await page.waitForFunction(()=>document.querySelector('.landing-product-demo')?.dataset.storyStage==='1'&&document.querySelector('.landing-product-demo textarea')?.value==='');
  assert.equal(await page.$eval('.landing-product-demo textarea',node=>node.value),'','Visual send clears the composer');
  assert.match(await page.$eval('.chat-user',node=>node.textContent),/race-day edit/);
  const splits=[];
  for(const expected of [{stage:2,clips:2,at:4.4},{stage:3,clips:3,at:10.2},{stage:4,clips:4,at:2},{stage:5,clips:5,at:6.2},{stage:6,clips:6,at:8.6}].map(step=>({...step,at:step.at*duration/13.2,duration}))){
    await page.waitForFunction(({stage,clips,at,duration})=>{
      const root=document.querySelector('.landing-product-demo');
      if(Number(root?.dataset.storyStage)!==stage)return false;
      const blocks=[...root.querySelectorAll('.timeline-clip.clip-video')];
      const head=root.querySelector('.playhead'),cap=root.querySelector('.timeline-playhead-cap');
      if(blocks.length!==clips||!head||!cap)return false;
      const start=Math.min(...blocks.map(node=>Number.parseFloat(node.style.left)));
      const px=blocks.reduce((sum,node)=>sum+Number.parseFloat(node.style.width),0)/duration;
      const cut=start+at*px,headX=new DOMMatrixReadOnly(head.style.transform).m41;
      const headBounds=head.getBoundingClientRect(),capBounds=cap.getBoundingClientRect();
      return Math.abs(headX-cut)<1&&Math.abs((capBounds.x+capBounds.width/2)-(headBounds.x+headBounds.width/2))<1.5;
    },{timeout:8000},expected);
    const state=await playback();splits.push({...expected,...state});
    assert.equal(state.count,1);assert.ok(state.samePlayer&&state.sameFrame,'A staged split keeps the same YouTube player and iframe mounted');assert.equal(state.paused,false,'The featured film keeps playing while sample timeline cuts appear');
    if(expected.stage===3)await page.screenshot({path:'/tmp/revline-landing-demo-split.png'});
  }
  await page.waitForFunction(()=>document.querySelector('.landing-product-demo')?.dataset.storyStage==='9',{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('.landing-demo-reply')?.textContent.includes('Here’s the edit.'));
  const narration=await page.evaluate(()=>window.story.flatMap(frame=>frame.reply===null?[]:[frame.reply]));
  for(let index=1;index<narration.length;index++)assert.ok(narration[index].startsWith(narration[index-1]),'New narration preserves all previously visible words instead of flashing the reply empty');
  const pause=await page.$eval('[aria-label="Pause (Space)"]',node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(pause.x,pause.y);const before=await playback();await new Promise(resolve=>setTimeout(resolve,650));const after=await playback();assert.equal(after.paused,false,'Pointer clicks cannot operate the visual controls');
  assert.ok(after.time>before.time+.25,'Featured film keeps playing automatically');assert.equal(after.muted,true);
  assert.equal(await page.$$eval('.timeline-clip.clip-video',nodes=>nodes.length),6);assert.equal(await page.$$eval('.timeline-clip.clip-graphic',nodes=>nodes.length),3);
  assert.ok(await page.$$eval('.landing-product-demo :is(button,a,textarea,input,iframe)',nodes=>nodes.length>10&&nodes.every(node=>node.closest('[inert]'))),'Every editor control and the featured film are inert');
  assert.equal(await page.$eval('.floating-tools-rail',node=>getComputedStyle(node).display),'none','Effects rail stays hidden');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.landing-product-demo')),false);
  await page.screenshot({path:'/tmp/revline-landing-auto-edit-desktop.png'});
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelector('.landing-product-demo').dataset.storyActive==='false');
  const parked=await playback();await new Promise(resolve=>setTimeout(resolve,550));const still=await playback();assert.equal(still.paused,true);assert.ok(Math.abs(still.time-parked.time)<.1,'Offscreen playback stops');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>document.querySelector('.landing-product-demo').dataset.storyActive==='true'&&!window.youtubeFixture.players[0].paused);
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const reduced=await playback();await new Promise(resolve=>setTimeout(resolve,550));const reducedAfter=await playback();assert.ok(reducedAfter.time>reduced.time+.2,'Requested video autoplay continues with Reduced Motion');assert.equal(reducedAfter.paused,false);assert.ok(await page.$$eval('.timeline-clip',nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none')),'Reduced Motion removes decorative clip arrivals');
  await page.setViewport({width:795,height:900});await page.waitForSelector('.landing-compact-sent');assert.match(await page.$eval('.landing-compact-sent',node=>node.textContent),/race-day edit/);assert.equal(await page.$('.landing-compact-prompt textarea'),null,'Compact visual send moves the prompt out of the composer');
  await page.setViewport({width:390,height:900});await page.waitForFunction(()=>{
    const frame=document.querySelector('.preview-viewport-frame').getBoundingClientRect(),film=document.querySelector('.landing-f1-player iframe').getBoundingClientRect();
    return frame.width>100&&frame.right<=390&&Math.abs(film.width-frame.width)<1&&Math.abs(film.height-frame.height)<1;
  });
  assert.equal(await page.$eval('.editor-chat-panel',node=>getComputedStyle(node).display),'none','Mobile shows the footage rather than a blocking conversation panel');assert.ok(await page.$eval('.timeline-clip.clip-video',node=>{const r=node.getBoundingClientRect();return r.width>0&&r.x<390&&r.y<780;}),'Mobile timeline remains visible below the prompt strip');
  const mobile=await playback();assert.equal(mobile.count,1);assert.ok(mobile.samePlayer&&mobile.sameFrame,'Responsive layout retains the same player');
  await page.screenshot({path:'/tmp/revline-landing-auto-edit-mobile.png'});
  const story=await page.evaluate(()=>{window.storyObserver.disconnect();return window.story;});assert.deepEqual([...new Set(story.map(frame=>frame.clips))].sort((a,b)=>a-b),[1,2,3,4,5,6],'Each sample split reveals one additional clip');
  await page.evaluate(()=>window.unmountDemo());assert.equal(await page.evaluate(()=>window.youtubeFixture.destroyed),1,'Unmount destroys the player');
  // A fresh compact mount checks typing without waiting a full film for the story to repeat.
  await page.setViewport({width:795,height:900});await page.reload();
  await page.waitForFunction(()=>document.querySelector('.landing-compact-prompt textarea')?.value.length>3);
  const compactTyped=await page.$eval('.landing-compact-prompt textarea',node=>({text:node.value,width:node.getBoundingClientRect().width}));assert.ok(compactTyped.width>100,'Typing composer is visible at 795px');await page.waitForFunction(text=>document.querySelector('.landing-compact-prompt textarea')?.value.length>text.length,{},compactTyped.text);
  await page.waitForSelector('.landing-compact-sent');assert.equal(await page.$('.landing-compact-prompt textarea'),null,'Compact typing clears when the prompt sends');
  assert.deepEqual(errors,[]);assert.deepEqual(unexpectedExternal,[]);assert.ok(requests.every(request=>request.method==='GET'),'No uploads or AI/backend mutations');assert.ok(requests.every(request=>!request.path.startsWith('/demo/racing/')),'No previous racing montage or thumbnails are requested');
  const proof={configuration,splits,narrationSamples:narration.length,replyClears:0,playback:{before:before.time,after:after.time,muted:after.muted},clipStages:[...new Set(story.map(frame=>frame.clips))],requests:requests.map(request=>request.path),mocked,errors,unexpectedExternal};
  await writeFile('/tmp/revline-landing-demo-loading-proof.json',JSON.stringify(proof,null,2));console.log('PASS: selected F1 player configuration, stable single iframe, muted autoplay, sample timeline splits, inert controls, offscreen pause, Reduced Motion, mobile preview, compact typing, cleanup, and no previous racing media or backend calls. YouTube delivery was mocked.');console.log(JSON.stringify(proof));await page.evaluate(()=>window.unmountDemo());
}finally{server.closeAllConnections();await browser.close();await new Promise(resolve=>server.close(resolve));}
