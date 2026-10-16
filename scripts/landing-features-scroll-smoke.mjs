import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot,hydrateRoot} from 'react-dom/client';import {LandingFeatures} from './components/landing/features';import {FEATURE_MEDIA} from './components/landing/features-media-config';import './app/landing.css';
window.featureFixtureMedia=FEATURE_MEDIA;
const host=document.getElementById('root'),fixture=<main className="landing"><div style={{height:400}}/><LandingFeatures/><section id="pricing" className="landing-section" style={{height:1400}}>Pricing target</section></main>;window.featureFixtureRoot=host.hasChildNodes()?hydrateRoot(host,fixture):createRoot(host);if(!host.hasChildNodes())window.featureFixtureRoot.render(fixture);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-feature-scroll-fixture',external:['/fonts/*'],define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const serverBundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {renderToString} from 'react-dom/server';import {LandingFeatures} from './components/landing/features';
export const html=renderToString(<main className="landing"><div style={{height:400}}/><LandingFeatures/><section id="pricing" className="landing-section" style={{height:1400}}>Pricing target</section></main>);
`},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'server-css',setup(builder){builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}]});
const serverModule={exports:{}};new Function('require','module','exports',serverBundle.outputFiles[0].text)(createRequire(import.meta.url),serverModule,serverModule.exports);
const fixtureStyle='*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;--font-space-grotesk:Arial;--font-inter:Arial}button{font-family:inherit}';
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'}).end('<div id="root"></div>');return;}
 if(pathname==='/anchor'){res.writeHead(200,{'content-type':'text/html'}).end(`<html><style>${bundle.outputFiles.find(file=>file.path.endsWith('.css')).text}${fixtureStyle}html{scroll-behavior:smooth}</style><div id="root">${serverModule.exports.html}</div><script>setTimeout(()=>{${bundle.outputFiles.find(file=>file.path.endsWith('.js')).text}},200)</script></html>`);return;}
 const bytes=await readFile('public'+pathname),mime=pathname.endsWith('.mp4')?'video/mp4':pathname.endsWith('.woff2')?'font/woff2':pathname.endsWith('.ttf')?'font/ttf':'image/webp';
 if(req.headers.range){const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range),start=Number(match[1]),end=Math.min(bytes.length-1,match[2]?Number(match[2]):bytes.length-1);res.writeHead(206,{'content-type':mime,'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${bytes.length}`,'content-length':end-start+1}).end(bytes.subarray(start,end+1));return;}
 res.writeHead(200,{'content-type':mime,'content-length':bytes.length}).end(bytes);
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();const errors=[],external=[];page.on('pageerror',error=>{errors.push(error.message);console.log('Fixture error: '+error.message)});
await page.setRequestInterception(true);page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith(origin)){external.push(request.url());void request.abort();}else void request.continue();});
await page.goto(origin);
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const active=()=>page.$eval('.landing-features-trigger[data-state="active"]',el=>el.textContent);
let features=[];
const feature=id=>{const item=features.find(item=>item.id===id);assert.ok(item,`Feature ${id} is present`);return item;};
async function select(id){await page.locator(`::-p-aria([name="${feature(id).label}"][role="tab"])`).click();await flush();}
async function autoplay(id,motion){
 await page.waitForFunction((id,start)=>{const root=document.querySelector(`[data-feature-media="${id}"]`),videos=[...root?.querySelectorAll('video')??[]];return root?.dataset.playing==='true'&&videos.length>0&&videos.every(video=>!video.paused&&video.currentTime>start+.2);},{timeout:5000},id,feature(id).start);
 assert.equal(await page.$$eval('.feature-demo',nodes=>nodes.length),1,`${motion}: only selected ${id} mounts its renderer`);
 assert.equal(await page.$$eval('.landing-features video',nodes=>nodes.length),id==='subject'?2:1,`${motion}: only selected ${id} decodes video`);
}
async function mount(motion,width=1440,height=1000){
 await page.evaluate(()=>window.featureFixtureRoot?.unmount());
 await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:motion}]);
 await page.setContent('<div id="root"></div>');await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;--font-space-grotesk:Arial;--font-inter:Arial}html{scroll-behavior:auto}button{font-family:inherit}'});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});await page.waitForSelector('.landing-features-trigger',{timeout:5000});await flush();
 features=await page.evaluate(()=>[...document.querySelectorAll('.landing-features-panel')].map((panel,index)=>{const id=[...panel.querySelector('figure').classList].find(value=>value.startsWith('landing-features-preview-')).slice('landing-features-preview-'.length);return{id,label:document.querySelectorAll('.landing-features-trigger')[index].textContent,...window.featureFixtureMedia[id]};}));
}
async function segments(motion){
 await mount(motion);
 const metrics=await page.evaluate(()=>{const rail=document.querySelector('.landing-feature-scroll-rail'),stage=document.querySelector('.landing-feature-scroll-stage');return{start:scrollY+rail.getBoundingClientRect().top-parseFloat(stage.style.top||'0'),range:rail.offsetHeight-stage.offsetHeight,enabled:document.querySelector('#features').dataset.scrollDriven}});
 console.log(JSON.stringify({motion,...metrics}));
 assert.equal(metrics.enabled,'true',`${motion}: scroll segments stay enabled when the content fits`);
 for(let index=0;index<features.length;index++){
  await page.evaluate(top=>scrollTo({top,behavior:'instant'}),metrics.start+metrics.range*index/(features.length-1));await flush();
  assert.equal(await active(),features[index].label,`${motion}: scrolling activates segment ${index+1}`);
  assert.equal(await page.$$eval('.landing-features-panel[aria-hidden="false"]',panels=>panels.length),1,'Exactly one preview is exposed');
  await autoplay(features[index].id,motion);
 }
 await page.evaluate(top=>scrollTo({top,behavior:'instant'}),metrics.start);await flush();assert.equal(await active(),features[0].label,'Scrolling upward restores the first segment');
 await select('beats');assert.equal(await active(),feature('beats').label,'Click selection still works');
 const beatIndex=features.findIndex(item=>item.id==='beats'),subjectIndex=features.findIndex(item=>item.id==='subject');
 assert.ok(Math.abs((await page.evaluate(()=>scrollY))-(metrics.start+metrics.range*beatIndex/(features.length-1)))<2,'Click aligns the page with the chosen segment');
 await page.mouse.wheel({deltaY:metrics.range*(subjectIndex-beatIndex)/(features.length-1)});await page.waitForFunction(label=>document.querySelector('.landing-features-trigger[data-state="active"]').textContent===label,{},feature('subject').label);
 assert.equal(await active(),feature('subject').label,'Wheel scrolling continues after a deliberate click');
 if(motion==='reduce')assert.equal(await page.$eval('.landing-features-panel',el=>getComputedStyle(el).transitionDuration),'0s','Reduced motion uses instant segment changes');
 return metrics;
}
try{
 await page.setViewport({width:1440,height:1000});
 await page.goto(origin+'/anchor#pricing');
 await page.waitForFunction(()=>document.querySelector('#features')?.dataset.scrollDriven==='true');
 await page.evaluate(()=>document.fonts.ready);await new Promise(resolve=>setTimeout(resolve,700));
 const anchorTop=await page.$eval('#pricing',node=>node.getBoundingClientRect().top);
 assert.ok(Math.abs(anchorTop-92)<2,`Initial pricing anchor survives the hydrated feature rail (top ${anchorTop})`);
 await page.evaluateOnNewDocument(()=>{window.fontGate=new Promise(resolve=>{window.releaseFontGate=resolve;});Object.defineProperty(document.fonts,'ready',{get:()=>window.fontGate});});
 await page.goto(origin+'/anchor?fonts-delayed=1#pricing');
 await page.waitForFunction(()=>document.querySelector('#features')?.dataset.scrollDriven==='true');
 await new Promise(resolve=>setTimeout(resolve,700));
 await page.evaluate(()=>{window.dispatchEvent(new WheelEvent('wheel'));scrollTo({top:250,behavior:'instant'});});
 await page.evaluate(()=>window.releaseFontGate());await new Promise(resolve=>setTimeout(resolve,120));
 const userScrollY=await page.evaluate(()=>scrollY);
 assert.ok(Math.abs(userScrollY-250)<2,`User input cancels delayed initial-fragment realignment (scroll ${userScrollY})`);
 console.log(JSON.stringify({initialPricingAnchorTop:anchorTop,userInputCancelledRealignment:true}));
 await segments('no-preference');
 assert.equal(features.length,5,'All five editing features are present');await select('titles');
 await page.waitForFunction(()=>document.querySelector('.feature-demo-titles video')?.currentTime>.5);
 assert.equal(await page.$$eval('.feature-demo',nodes=>nodes.length),1,'Only the active feature mounts its media renderer');
 assert.equal(await page.$$eval('.landing-features video',nodes=>nodes.length),1,'Other force-mounted panels do not download/decode videos');
 const frame=await page.$eval('[data-remotion-text="type-trails"]',node=>node.dataset.frame);
 await page.waitForFunction(previous=>document.querySelector('[data-remotion-text="type-trails"]')?.dataset.frame!==previous,{},frame);
 await page.screenshot({path:'/tmp/revline-landing-features-title-video.png'});
 await select('beats');
 await page.waitForFunction(()=>document.querySelector('.feature-demo-beats video')?.currentTime>.1);
 assert.equal(await page.$$eval('.feature-demo-cut-strip>span',nodes=>nodes.length),12,'Twelve real cuts match the half-second NASA montage');
 assert.equal(await page.$$eval('.feature-demo-cut-strip img',nodes=>nodes.length),12,'Each cut shows its real NASA shot thumbnail');
 assert.equal(await page.$$eval('.feature-demo-cut-strip img',nodes=>new Set(nodes.map(node=>node.currentSrc||node.src)).size),3,'The filmstrip distinguishes all three actual camera views');
 assert.equal(await page.$eval('.feature-demo-rhythm-footer>span',node=>node.textContent),'Rhythm guide','The silent example does not claim measured soundtrack audio');
 const beatIndex=await page.$eval('.feature-demo-rhythm',node=>node.dataset.beatIndex);await page.waitForFunction(previous=>document.querySelector('.feature-demo-rhythm')?.dataset.beatIndex!==previous,{},beatIndex);
 assert.match(await page.$eval('.feature-demo-beats video',node=>node.currentSrc),/nasa-beats\.mp4$/);
 await page.screenshot({path:'/tmp/revline-landing-features-beats-video.png'});
 await select('moments');await autoplay('moments','faster selects');
 assert.equal(await page.$eval('.feature-demo-moments video',node=>node.playbackRate),2,'Moments runs the twelve-second source at double speed');
 const before=await page.$eval('.feature-demo-moments video',node=>({time:node.currentTime,wall:performance.now()}));await new Promise(resolve=>setTimeout(resolve,300));const after=await page.$eval('.feature-demo-moments video',node=>({time:node.currentTime,wall:performance.now()}));
 assert.ok((after.time-before.time)/((after.wall-before.wall)/1000)>1.5,'Native moments clock advances at the faster pace');
 await page.screenshot({path:'/tmp/revline-landing-features-moments-video.png'});
 await select('captions');
 await page.waitForFunction(()=>document.querySelector('.feature-demo-captions video')?.currentTime>3);
 assert.ok(await page.$('[data-remotion-text="karaoke"] [data-word-index]'),'Caption preview uses the shared word-timed renderer');
 await page.screenshot({path:'/tmp/revline-landing-features-captions-video.png'});
 await page.locator('::-p-aria([name="Pause feature preview"])').click();
 const paused=await page.$eval('.feature-demo video',node=>node.currentTime);await new Promise(resolve=>setTimeout(resolve,220));
 assert.ok(Math.abs(await page.$eval('.feature-demo video',node=>node.currentTime)-paused)<.05,'Pause holds footage and timed text');
 for(const preference of ['reduce','no-preference']){
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:preference}]);await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(await page.$eval('.feature-demo',node=>node.dataset.playing),'false',`${preference}: preference changes preserve the user's pause`);
  assert.equal(await page.$eval('.feature-demo video',node=>node.paused),true);
  assert.ok(Math.abs(await page.$eval('.feature-demo video',node=>node.currentTime)-paused)<.05);
 }
 await page.locator('::-p-aria([name="Play feature preview"])').click();await autoplay('captions','manual resume');
 const background=await browser.newPage();await background.bringToFront();await new Promise(resolve=>setTimeout(resolve,180));
 const nativeHidden=await page.evaluate(()=>document.hidden);
 if(nativeHidden){
  assert.equal(await page.$eval('.feature-demo video',node=>node.paused),true,'A natively hidden tab pauses video');
  const hiddenTime=await page.$eval('.feature-demo video',node=>node.currentTime);await new Promise(resolve=>setTimeout(resolve,180));
  assert.ok(Math.abs(await page.$eval('.feature-demo video',node=>node.currentTime)-hiddenTime)<.05,'Hidden page does not advance its media clock');
 }else console.log('Native hidden-tab check unavailable in this headless browser.');
 await background.close();await page.bringToFront();await autoplay('captions','visible again');
 await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelectorAll('.landing-features video').length===0);
 await segments('reduce');
 await autoplay('subject','reduce');
 await page.screenshot({path:'/tmp/revline-landing-features-reframe.png'});
 await select('titles');await autoplay('titles','reduce');
 const reducedFrame=await page.$eval('[data-remotion-text="type-trails"]',node=>node.dataset.frame);
 await page.waitForFunction(previous=>document.querySelector('[data-remotion-text="type-trails"]')?.dataset.frame!==previous,{},reducedFrame);
 assert.equal(await page.$eval('#landing-features-heading',el=>el.textContent),'Features');assert.equal(await page.$('.landing-features-heading>p'),null,'Removed the heading subtitle');
 await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:'/tmp/revline-landing-features-scroll.png'});
 await mount('no-preference',390,844);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile stays inside viewport');await select('captions');assert.equal(await active(),feature('captions').label,'Mobile tabs remain usable');
 await page.$eval('.landing-features-panels',node=>node.scrollIntoView({block:'center'}));await page.waitForFunction(()=>document.querySelector('.feature-demo-captions video')?.currentTime>3);
 await page.screenshot({path:'/tmp/revline-landing-features-mobile.png'});
 await mount('no-preference',1440,420);assert.equal(await page.$eval('#features',el=>el.dataset.scrollDriven),'false','Short viewport uses normal tabs rather than clipping a pinned preview');await select('moments');assert.equal(await active(),feature('moments').label);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(`PASS: All five features autoplay under both motion preferences; moments at 2×, real beat filmstrip/pulse clock, product text clocks, persistent manual pause, offscreen unmount, native hidden-tab pause (${nativeHidden?'verified':'unavailable'}), scroll/tab behavior, mobile and short viewport. Local footage only; no backend or provider calls.`);
}finally{server.closeAllConnections();await browser.close();await new Promise(resolve=>server.close(resolve));}
