import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

// Actual editor/Preview, isolated navigation and media only. No account or provider calls.
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
try{
  const page=await browser.newPage(),errors=[],external=[];page.setDefaultTimeout(20000);
  page.on('pageerror',error=>errors.push(error.message));await page.setRequestInterception(true);
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin)){external.push(request.url());void request.abort();}else void request.continue();});
  await page.setViewport({width:1280,height:900});await page.goto(origin);
  await page.waitForFunction(()=>document.querySelector('.landing-product-demo[data-story-stage="0"] textarea')?.value.length>3);
  const typed=await page.$eval('.landing-product-demo textarea',node=>node.value);
  await page.waitForFunction(previous=>document.querySelector('.landing-product-demo textarea')?.value.length>previous.length,{},typed);
  await page.evaluate(()=>{
    window.story=[];
    window.firstLandingPlayer=[...document.querySelectorAll('hyperframes-player')].find(node=>node.style.zIndex==='1');
    window.firstLandingDocument=window.firstLandingPlayer.iframeElement.contentDocument;
    window.storyObserver=new MutationObserver(()=>{const root=document.querySelector('.landing-product-demo');window.story.push({stage:root.dataset.storyStage,clips:root.querySelectorAll('.clip-video').length,titles:root.querySelectorAll('.clip-graphic').length,prompt:root.querySelector('textarea')?.value??'',reply:root.querySelector('.landing-demo-reply')?.textContent??null});});
    window.storyObserver.observe(document.querySelector('.landing-product-demo'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-story-stage']});
  });
  await page.waitForFunction(()=>document.querySelector('.landing-product-demo')?.dataset.storyStage==='1'&&document.querySelector('.landing-product-demo textarea')?.value==='');
  assert.equal(await page.$eval('.landing-product-demo textarea',node=>node.value),'','Visual send clears the composer');
  assert.match(await page.$eval('.chat-user',node=>node.textContent),/launch cinematic/);
  const splits=[];
  for(const expected of [{stage:2,clips:2,at:4.8},{stage:3,clips:3,at:7.7},{stage:4,clips:4,at:2.4},{stage:5,clips:5,at:6.3}]){
    await page.waitForFunction(({stage,clips,at})=>{
      const root=document.querySelector('.landing-product-demo');
      if(Number(root?.dataset.storyStage)!==stage)return false;
      const blocks=[...root.querySelectorAll('.timeline-clip.clip-video')];
      const player=[...root.querySelectorAll('hyperframes-player')].find(node=>node.style.zIndex==='1');
      const clock=player?.iframeElement?.contentWindow?.__timelines?.revline?.time();
      const head=root.querySelector('.playhead'),cap=root.querySelector('.timeline-playhead-cap');
      if(blocks.length!==clips||clock===undefined||!head||!cap)return false;
      const origin=Math.min(...blocks.map(node=>Number.parseFloat(node.style.left)));
      const px=blocks.reduce((sum,node)=>sum+Number.parseFloat(node.style.width),0)/12;
      const cut=origin+at*px,headX=new DOMMatrixReadOnly(head.style.transform).m41;
      const headBounds=head.getBoundingClientRect(),capBounds=cap.getBoundingClientRect();
      return player.paused&&Math.abs(clock-at)<1/30&&Math.abs(headX-cut)<1&&Math.abs((capBounds.x+capBounds.width/2)-(headBounds.x+headBounds.width/2))<1.5;
    },{timeout:8000},expected);
    splits.push(await page.evaluate(expected=>{
      const root=document.querySelector('.landing-product-demo');
      const blocks=[...root.querySelectorAll('.timeline-clip.clip-video')];
      const player=[...root.querySelectorAll('hyperframes-player')].find(node=>node.style.zIndex==='1');
      const head=root.querySelector('.playhead'),cap=root.querySelector('.timeline-playhead-cap');
      const origin=Math.min(...blocks.map(node=>Number.parseFloat(node.style.left)));
      const px=blocks.reduce((sum,node)=>sum+Number.parseFloat(node.style.width),0)/12;
      const headBounds=head.getBoundingClientRect(),capBounds=cap.getBoundingClientRect();
      return {...expected,samePlayer:player===window.firstLandingPlayer,sameDocument:player.iframeElement.contentDocument===window.firstLandingDocument,time:player.iframeElement.contentWindow.__timelines.revline.time(),paused:player.paused,headX:new DOMMatrixReadOnly(head.style.transform).m41,cutX:origin+expected.at*px,capOffset:(capBounds.x+capBounds.width/2)-(headBounds.x+headBounds.width/2)};
    },expected));
    assert.ok(splits.at(-1).samePlayer&&splits.at(-1).sameDocument,'A staged split keeps the live player and iframe document mounted');
    if(expected.stage===3)await page.screenshot({path:'/tmp/revline-landing-demo-split.png'});
  }
  await page.waitForFunction(()=>document.querySelector('.landing-product-demo')?.dataset.storyStage==='8',{timeout:30000});
  await page.waitForFunction(()=>{const player=[...document.querySelectorAll('hyperframes-player')].find(node=>node.style.zIndex==='1');return player&&!player.paused&&player.currentTime>.2;});
  await page.waitForFunction(()=>document.querySelector('.landing-demo-reply')?.textContent.includes('Here’s the edit.'));
  const narration=await page.evaluate(()=>window.story.flatMap(frame=>frame.reply===null?[]:[frame.reply]));
  for(let index=1;index<narration.length;index++)assert.ok(narration[index].startsWith(narration[index-1]),'New narration preserves all previously visible words instead of flashing the reply empty');
  const playback=()=>page.evaluate(()=>{const player=[...document.querySelectorAll('hyperframes-player')].find(node=>node.style.zIndex==='1');return {time:player.currentTime,paused:player.paused,muted:player.muted,media:[...player.iframeElement.contentDocument.querySelectorAll('video')].map(node=>({src:node.src,muted:node.muted,ready:node.readyState})),text:player.iframeElement.contentDocument.body.textContent};});
  const pause=await page.$eval('[aria-label="Pause (Space)"]',node=>{const r=node.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.mouse.click(pause.x,pause.y);const before=await playback();await new Promise(resolve=>setTimeout(resolve,650));const after=await playback();assert.equal(after.paused,false,'Pointer clicks cannot operate the visual controls');
  assert.ok(after.time>before.time+.25,'Finished composition plays automatically');assert.equal(after.muted,true);assert.ok(after.media.every(node=>node.muted&&node.src.includes('/demo/landing/nasa.mp4')));assert.match(after.text,/ARTEMIS II/);
  assert.equal(await page.$$eval('.timeline-clip.clip-video',nodes=>nodes.length),5);assert.equal(await page.$$eval('.timeline-clip.clip-graphic',nodes=>nodes.length),3);
  assert.ok(await page.$$eval('.landing-product-demo :is(button,a,textarea,input)',nodes=>nodes.length>10&&nodes.every(node=>node.closest('[inert]'))),'Every editor control is inert');
  assert.equal(await page.$eval('.floating-tools-rail',node=>getComputedStyle(node).display),'none','Effects rail stays hidden');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('.landing-product-demo')),false);
  await page.screenshot({path:'/tmp/revline-landing-auto-edit-desktop.png'});
  if(process.env.UPDATE_POSTER==='1'){const image=await page.$('.landing-product-demo');await sharp(await image.screenshot()).webp({quality:78}).toFile('public/images/editor-demo-poster.webp');}
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelector('.landing-product-demo').dataset.storyActive==='false');
  const parked=await playback();await new Promise(resolve=>setTimeout(resolve,550));const still=await playback();assert.equal(still.paused,true);assert.ok(Math.abs(still.time-parked.time)<.1,'Offscreen playback stops');
  await page.evaluate(()=>window.scrollTo(0,0));await page.waitForFunction(()=>document.querySelector('.landing-product-demo').dataset.storyActive==='true');
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
  const reduced=await playback();await new Promise(resolve=>setTimeout(resolve,550));const reducedAfter=await playback();assert.ok(reducedAfter.time>reduced.time+.2,'Requested video autoplay continues with Reduced Motion');assert.equal(reducedAfter.paused,false);assert.ok(await page.$$eval('.timeline-clip',nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none')),'Reduced Motion removes decorative clip arrivals');
  await page.setViewport({width:795,height:900});await page.waitForFunction(()=>document.querySelector('.landing-product-demo').dataset.storyStage==='0'&&document.querySelector('.landing-compact-prompt textarea')?.value.length>3,{timeout:18000});const compactTyped=await page.$eval('.landing-compact-prompt textarea',node=>({text:node.value,width:node.getBoundingClientRect().width}));assert.ok(compactTyped.width>100,'Typing composer is visible at795px');await page.waitForFunction(text=>document.querySelector('.landing-compact-prompt textarea')?.value.length>text.length,{},compactTyped.text);await page.waitForSelector('.landing-compact-sent');assert.match(await page.$eval('.landing-compact-sent',node=>node.textContent),/launch cinematic/);assert.equal(await page.$('.landing-compact-prompt textarea'),null,'Compact visualsend moves the prompt out of the composer');
  await page.setViewport({width:390,height:900});await page.waitForFunction(()=>{const frame=document.querySelector('.preview-viewport-frame').getBoundingClientRect();return frame.width>100&&frame.right<=390;});
  assert.equal(await page.$eval('.editor-chat-panel',node=>getComputedStyle(node).display),'none','Mobile shows the footage rather than a blocking conversation panel');assert.ok(await page.$eval('.timeline-clip.clip-video',node=>{const r=node.getBoundingClientRect();return r.width>0&&r.x<390&&r.y<780;}),'Mobile timeline remains visible below the prompt strip');
  await page.screenshot({path:'/tmp/revline-landing-auto-edit-mobile.png'});
  const story=await page.evaluate(()=>{window.storyObserver.disconnect();return window.story;});assert.deepEqual([...new Set(story.map(frame=>frame.clips))].sort((a,b)=>a-b),[1,2,3,4,5],'Each real split reveals one additional clip');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.ok(requests.every(request=>request.method==='GET'),'No uploads or AI/backend mutations');
  const proof={splits,narrationSamples:narration.length,replyClears:0,playback:{before:before.time,after:after.time,muted:after.muted},clipStages:[...new Set(story.map(frame=>frame.clips))],requests:requests.map(request=>request.path),errors,external};
  await writeFile('/tmp/revline-landing-demo-loading-proof.json',JSON.stringify(proof,null,2));console.log('PASS: typed composer → clear/send → four real splits at the aligned playhead → titles → muted autoplay; inert controls, hidden effects rail, offscreen pause, Reduced Motion removes decoration while requested autoplay continues, mobile preview, no external/backend calls.');console.log(JSON.stringify(proof));await page.evaluate(()=>window.unmountDemo());
}finally{server.closeAllConnections();await browser.close();await new Promise(resolve=>server.close(resolve));}
