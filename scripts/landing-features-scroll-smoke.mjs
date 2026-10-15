import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {LandingFeatures} from './components/landing/features';import './app/landing.css';
window.featureFixtureRoot=createRoot(document.getElementById('root'));window.featureFixtureRoot.render(<main className="landing"><div style={{height:400}}/><LandingFeatures/><div style={{height:1400}}/></main>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-feature-scroll-fixture',external:['/fonts/*'],define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://fixture').pathname;
 if(pathname==='/'){res.writeHead(200,{'content-type':'text/html'}).end('<div id="root"></div>');return;}
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
const labels=['Titles in motion','Find the moments','Cut to the beat','Keep the subject in frame','Captions that follow'];
async function mount(motion,width=1440,height=1000){
 await page.evaluate(()=>window.featureFixtureRoot?.unmount());
 await page.setViewport({width,height});await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:motion}]);
 await page.setContent('<div id="root"></div>');await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;--font-space-grotesk:Arial;--font-inter:Arial}html{scroll-behavior:auto}button{font-family:inherit}'});
 await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});await page.waitForSelector('.landing-features-trigger',{timeout:5000});await flush();
}
async function segments(motion){
 await mount(motion);
 const metrics=await page.evaluate(()=>{const rail=document.querySelector('.landing-feature-scroll-rail'),stage=document.querySelector('.landing-feature-scroll-stage');return{start:scrollY+rail.getBoundingClientRect().top-parseFloat(stage.style.top||'0'),range:rail.offsetHeight-stage.offsetHeight,enabled:document.querySelector('#features').dataset.scrollDriven}});
 console.log(JSON.stringify({motion,...metrics}));
 assert.equal(metrics.enabled,'true',`${motion}: scroll segments stay enabled when the content fits`);
 for(let index=0;index<labels.length;index++){
  await page.evaluate(top=>scrollTo({top,behavior:'instant'}),metrics.start+metrics.range*index/4);await flush();
  assert.equal(await active(),labels[index],`${motion}: scrolling activates segment ${index+1}`);
  assert.equal(await page.$$eval('.landing-features-panel[aria-hidden="false"]',panels=>panels.length),1,'Exactly one preview is exposed');
 }
 await page.evaluate(top=>scrollTo({top,behavior:'instant'}),metrics.start);await flush();assert.equal(await active(),labels[0],'Scrolling upward restores the first segment');
 await page.locator('::-p-aria([name="Cut to the beat"][role="tab"])').click();await flush();assert.equal(await active(),labels[2],'Click selection still works');
 assert.ok(Math.abs((await page.evaluate(()=>scrollY))-(metrics.start+metrics.range/2))<2,'Click aligns the page with the chosen segment');
 await page.mouse.wheel({deltaY:metrics.range/4});await page.waitForFunction(()=>document.querySelector('.landing-features-trigger[data-state="active"]').textContent==='Keep the subject in frame');
 assert.equal(await active(),labels[3],'Wheel scrolling continues after a deliberate click');
 if(motion==='reduce')assert.equal(await page.$eval('.landing-features-panel',el=>getComputedStyle(el).transitionDuration),'0s','Reduced motion uses instant segment changes');
 return metrics;
}
try{
 await segments('no-preference');
 await page.locator('::-p-aria([name="Titles in motion"][role="tab"])').click();
 await page.waitForFunction(()=>document.querySelector('.feature-demo-titles video')?.currentTime>.5);
 assert.equal(await page.$$eval('.feature-demo',nodes=>nodes.length),1,'Only the active feature mounts its media renderer');
 assert.equal(await page.$$eval('.landing-features video',nodes=>nodes.length),1,'Other force-mounted panels do not download/decode videos');
 const frame=await page.$eval('[data-remotion-text="type-trails"]',node=>node.dataset.frame);
 await page.waitForFunction(previous=>document.querySelector('[data-remotion-text="type-trails"]')?.dataset.frame!==previous,{},frame);
 await page.screenshot({path:'/tmp/revline-landing-features-title-video.png'});
 await page.locator('::-p-aria([name="Cut to the beat"][role="tab"])').click();
 await page.waitForFunction(()=>document.querySelector('.feature-demo-beats video')?.currentTime>.1);
 assert.equal(await page.$$eval('.feature-demo-cut-strip>span',nodes=>nodes.length),12,'Twelve real cuts match the half-second NASA montage');
 assert.match(await page.$eval('.feature-demo-beats video',node=>node.currentSrc),/nasa-beats\.mp4$/);
 await page.screenshot({path:'/tmp/revline-landing-features-beats-video.png'});
 await page.locator('::-p-aria([name="Find the moments"][role="tab"])').click();await page.waitForFunction(()=>document.querySelector('.feature-demo-moments video')?.currentTime>.2);
 await page.screenshot({path:'/tmp/revline-landing-features-moments-video.png'});
 await page.locator('::-p-aria([name="Captions that follow"][role="tab"])').click();
 await page.waitForFunction(()=>document.querySelector('.feature-demo-captions video')?.currentTime>3);
 assert.ok(await page.$('[data-remotion-text="karaoke"] [data-word-index]'),'Caption preview uses the shared word-timed renderer');
 await page.screenshot({path:'/tmp/revline-landing-features-captions-video.png'});
 await page.locator('::-p-aria([name="Pause feature preview"])').click();
 const paused=await page.$eval('.feature-demo video',node=>node.currentTime);await new Promise(resolve=>setTimeout(resolve,220));
 assert.ok(Math.abs(await page.$eval('.feature-demo video',node=>node.currentTime)-paused)<.05,'Pause holds footage and timed text');
 await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForFunction(()=>document.querySelectorAll('.landing-features video').length===0);
 await segments('reduce');
 await page.waitForFunction(()=>document.querySelector('.feature-demo-subject video')?.readyState>=2);
 assert.equal(await page.$$eval('.feature-demo video',nodes=>nodes.every(node=>node.paused)),true,'Reduced motion shows held real footage');
 await page.screenshot({path:'/tmp/revline-landing-features-reframe.png'});
 assert.equal(await page.$eval('#landing-features-heading',el=>el.textContent),'Features');assert.equal(await page.$('.landing-features-heading>p'),null,'Removed the heading subtitle');
 await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:'/tmp/revline-landing-features-scroll.png'});
 await mount('no-preference',390,844);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile stays inside viewport');await page.locator('::-p-aria([name="Captions that follow"][role="tab"])').click();await flush();assert.equal(await active(),labels[4],'Mobile tabs remain usable');
 await page.$eval('.landing-features-panels',node=>node.scrollIntoView({block:'center'}));await page.waitForFunction(()=>document.querySelector('.feature-demo-captions video')?.currentTime>3);
 await page.screenshot({path:'/tmp/revline-landing-features-mobile.png'});
 await mount('no-preference',1440,420);assert.equal(await page.$eval('#features',el=>el.dataset.scrollDriven),'false','Short viewport uses normal tabs rather than clipping a pinned preview');await page.locator('::-p-aria([name="Find the moments"][role="tab"])').click();await flush();assert.equal(await active(),labels[1]);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS: Scroll/tab behavior, active-only real videos, product title and speech-timed caption rendering, actual beat cuts, pause/offscreen/reduced-motion holds, mobile and short viewport. Local footage only; no backend or provider calls.');
}finally{server.closeAllConnections();await browser.close();await new Promise(resolve=>server.close(resolve));}
