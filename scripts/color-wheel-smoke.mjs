import assert from 'node:assert/strict';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useStore} from 'zustand';
import {TextEffectsControls} from './components/editor/text-effects-controls';import {createEditorStore} from './lib/editor/store';import {createTimelineSaveQueue} from './lib/editor/timeline-sync';import {EMPTY_TIMELINE} from './lib/editor/types';
const original={...EMPTY_TIMELINE,clips:[{id:'words',kind:'graphic',text:'Color test',duration:3,start:0,sourceStart:0,color:'#ffffff',textTemplate:{preset:'neon-echo'}}]};const store=createEditorStore(original);
window.stats={saves:0,commits:0};let revision=0;const queue=createTimelineSaveQueue({timeline:original,revision},{save:async edit=>{window.stats.saves++;return {timeline:structuredClone(edit.timeline),revision:++revision}},load:async()=>({timeline:original,revision}),update:next=>store.getState().replace(next),saving:()=>{},error:error=>{throw error}});
window.fixture={store,queue};function Fixture(){const timeline=useStore(store,s=>s.timeline);return <TextEffectsControls clip={timeline.clips[0]} onChange={patch=>{window.stats.commits++;if(window.stats.commits>200)throw Error('Color commit flood');const next={...store.getState().timeline,clips:[{...store.getState().timeline.clips[0],...patch}]};store.getState().edit(next);store.getState().replace(next);queue.edit(next)}}/>}createRoot(document.getElementById('root')).render(<Fixture/>);
`},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,outdir:'/tmp/revline-color-fixture',define:{'process.env.NODE_ENV':'"development"'}});
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});await page.waitForSelector('[aria-label="Text color"]');
for(const label of ['Text color','Text outline color']){
 const before=await page.evaluate(()=>({...window.stats,history:window.fixture.store.getState().history.length}));
 await page.evaluate(label=>{const input=document.querySelector('[aria-label="'+label+'"]');input.focus();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(let i=0;i<80;i++){set.call(input,'#'+(0x110000+i*64).toString(16));input.dispatchEvent(new Event('input',{bubbles:true}));}},label);
 assert.equal(await page.evaluate(()=>window.stats.commits),before.commits,'Wheel movement must not repeatedly edit the timeline');
 await page.evaluate(label=>{document.querySelector('[aria-label="'+label+'"]').dispatchEvent(new Event('change',{bubbles:true}));},label);
 await page.evaluate(()=>window.fixture.queue.wait());
 assert.equal(await page.evaluate(()=>window.stats.saves),before.saves+1,'Accepted color saves once');
 await page.evaluate(label=>{const input=document.querySelector('[aria-label="'+label+'"]');for(let i=0;i<80;i++)input.dispatchEvent(new Event('change',{bubbles:true}));input.blur();},label);
 await page.evaluate(()=>window.fixture.queue.wait());
 assert.equal(await page.evaluate(()=>window.stats.saves),before.saves+1,'Unchanged picker events and blur do not repeat saves');
 assert.equal(await page.evaluate(()=>window.fixture.store.getState().history.length),before.history+1,'One color choice creates one undo entry');
 await page.evaluate(label=>{const input=document.querySelector('[aria-label="'+label+'"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#abcdef');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();},label);
 assert.equal(await page.evaluate(()=>window.stats.saves),before.saves+1,'Cancelled draft never saves');
 assert.equal(await page.$eval('[aria-label="'+label+'"]', input=>input.value),'#1113c0','Cancelled draft restores accepted color');
}
await page.evaluate(()=>window.fixture.store.getState().undo());
await page.waitForFunction(()=>document.querySelector('[aria-label="Text outline color"]').value !== '#1113c0');
assert.equal(await page.evaluate(()=>window.stats.saves),2,'Undo synchronizes the picker without a new color save');
assert.deepEqual(errors,[]);console.log('PASS: both color controls, 80 draft events, single commit/save/undo, duplicate events, saved echoes, no update-depth errors. Synthetic fixture.');}finally{await browser.close()}
