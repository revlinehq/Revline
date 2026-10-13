import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});await page.goto('http://localhost:3001/editor/demo',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 await page.evaluate(()=>{
  const el=document.querySelector('.timeline-panel');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))],store;while(f){store??=f.memoizedProps?.store;f=f.return;}if(!store)throw Error('Missing store');
  const clip=store.getState().timeline.clips.find(c=>c.kind==='video'||c.kind==='image');store.getState().replace({fps:30,aspectRatio:'vertical',clips:[{...clip,id:'fixture',start:0,sourceStart:0,duration:20}]});store.setState({selectedId:'fixture',selectedIds:['fixture'],playhead:0});window.__proofStore=store;
 });await new Promise(r=>setTimeout(r,1000));await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 const automatic=!!await page.$('.visual-handles');assert.equal(automatic,false,'Timeline selection must not activate transform handles');
 await page.click('.preview-hit-surface');assert.equal(!!await page.$('.visual-handles'),false,'A single preview click only selects');
 await page.click('.preview-hit-surface',{count:2});await page.waitForSelector('.visual-selection-box');
 await page.click('[aria-label="Play (Space)"]');await new Promise(r=>setTimeout(r,150));const box=await page.$eval('.visual-selection-box',el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});
 await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x+25,box.y+18,{steps:5});
 const playing=await page.evaluate(()=>!document.querySelector('hyperframes-player[style*="z-index: 1"]')?.paused);
 await page.mouse.up();await new Promise(r=>setTimeout(r,250));const after=await page.evaluate(()=>window.__proofStore.getState().timeline.clips[0].transform);
 console.log(JSON.stringify({automaticTransform:automatic,playingDuringDrag:playing,transform:after}));assert.equal(automatic,false,'Timeline selection must not activate transform handles');assert.equal(playing,true,'A transform drag must preserve playback');
}finally{await browser.close();}
