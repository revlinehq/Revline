import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1440,height:1001});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function rect(selector){return page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});}
try{
 await page.goto('http://localhost:3001/editor/demo',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 const row=await rect('.timeline-track[data-group="visual"][data-layer="1"]');const clip=await rect('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip');
 const before=await page.$eval('.timeline-clip.clip-video',el=>el.getAttribute('aria-label'));
 await page.mouse.move(clip.x+clip.width/2,clip.y+clip.height/2);await page.mouse.down();await page.mouse.move(clip.x+clip.width/2,row.y-12,{steps:15});await wait(100);assert.ok(await page.$('[aria-label="Create visual layer above"]'),"Top insertion indicator must be visible");await page.mouse.up();await wait(200);
 assert.ok(await page.$('.timeline-track[data-group="visual"][data-layer="2"]'),'Dragging above V1 must create V2');
 assert.equal((await page.$$('.timeline-track[data-group="visual"][data-layer="2"] .timeline-clip')).length,1,'Dragged clip must land on V2');
 const after=await page.$eval('.timeline-track[data-group="visual"][data-layer="2"] .timeline-clip',el=>el.getAttribute('aria-label'));
 assert.equal(after.replace('V2','V1'),before,'Drag up must preserve timing and duration');
 await page.click('[aria-label="Undo"]');await wait(100);assert.equal(await page.$('.timeline-track[data-group="visual"][data-layer="2"]'),null,'Undo must remove the new layer');
 const lowerRow=await rect('.timeline-track[data-group="visual"][data-layer="1"]');const lowerClip=await rect('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip');
 await page.mouse.move(lowerClip.x+lowerClip.width/2,lowerClip.y+lowerClip.height/2);await page.mouse.down();await page.mouse.move(lowerClip.x+lowerClip.width/2,lowerRow.y+lowerRow.height+12,{steps:15});await wait(100);
 assert.ok(await page.$('[aria-label="Create visual layer below"]'),'Bottom insertion indicator must be visible');await page.mouse.up();await wait(200);
 assert.equal((await page.$$('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip')).length,1,'Dragging below must create a new bottom V1');
 assert.equal((await page.$$('.timeline-track[data-group="visual"][data-layer="2"] .timeline-clip')).length,8,'Other clips must move to V2 intact');
 const lowerLabel=await page.$eval('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip',el=>el.getAttribute('aria-label'));assert.equal(lowerLabel,before);
 await page.click('[aria-label="Undo"]');await wait(100);
 const second=await page.$$('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip');const secondRect=await second[1].boundingBox();
 await page.mouse.move(secondRect.x+secondRect.width/2,secondRect.y+secondRect.height/2);await page.mouse.down();await page.mouse.move(secondRect.x-secondRect.width/2,secondRect.y+secondRect.height/2,{steps:15});await wait(100);await page.mouse.up();await wait(200);
 assert.ok(await page.$('.timeline-track[data-group="visual"][data-layer="2"]'),'Overlapping drop must create a layer');assert.equal(await page.$('.editor-error-bar'),null,'No overlap warning should be shown');
 assert.ok(await page.$('.timeline-playback-time'),'Time readout remains in timeline');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,dragCreatesTopAndBottom:true,timingPreserved:true,undoRemovesLayer:true,visibleInsertionIndicators:true,collisionCreatesLayerWithoutWarning:true,transportInTimeline:true}));
}finally{await browser.close();}
