import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';

const bundle = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import {LandingFeatures} from './components/landing/features';import './app/landing.css';
window.featureFixtureRoot=createRoot(document.getElementById('root'));window.featureFixtureRoot.render(<main className="landing"><div style={{height:400}}/><LandingFeatures/><div style={{height:900}}/></main>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-feature-scroll-fixture',define:{'process.env.NODE_ENV':'"production"','process.env':'{}'}});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.log('Fixture error: '+error.message)});
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
 await segments('reduce');
 assert.equal(await page.$eval('#landing-features-heading',el=>el.textContent),'Features');assert.equal(await page.$('.landing-features-heading>p'),null,'Removed the heading subtitle');
 await page.evaluate(()=>document.activeElement?.blur());await page.screenshot({path:'/tmp/revline-landing-features-scroll.png'});
 await mount('no-preference',390,844);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile stays inside viewport');await page.locator('::-p-aria([name="Captions that follow"][role="tab"])').click();await flush();assert.equal(await active(),labels[4],'Mobile tabs remain usable');
 await mount('no-preference',1440,420);assert.equal(await page.$eval('#features',el=>el.dataset.scrollDriven),'false','Short viewport uses normal tabs rather than clipping a pinned preview');await page.locator('::-p-aria([name="Find the moments"][role="tab"])').click();await flush();assert.equal(await active(),labels[1]);
 assert.deepEqual(errors,[]);console.log('PASS: Rendered feature segments follow scroll down/up and wheel after clicks, including reduced motion; single heading, mobile and short-viewport fallback remain functional. Isolated fixture only.');
}finally{await browser.close()}
