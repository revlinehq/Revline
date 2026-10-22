import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1440,height:1001});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function rect(selector){return page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});}
try{
 await page.goto('http://localhost:3001/dev/editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 // The demo now starts with footage on V1 and text on V2/V3 (shared V-track model), so new layers are
 // created at the outer edges of the visual group. The insertion guide lost its aria-label in 81b883d;
 // assert the visible "New visual layer" guide instead.
 const visualRows=()=>page.$$eval('.timeline-track[data-group="visual"]',rows=>rows.map(row=>Number(row.dataset.layer)));
 const insertionGuide=()=>page.evaluate(()=>{const el=document.querySelector('.timeline-insert-indicator');if(!el||getComputedStyle(el).display==='none')return null;const r=el.getBoundingClientRect();return {y:r.y,text:el.textContent};});
 const initialRows=await visualRows();const top=Math.max(...initialRows);
 const topRow=await rect(`.timeline-track[data-group="visual"][data-layer="${top}"]`);const clip=await rect('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip');
 const before=await page.$eval('.timeline-clip.clip-video',el=>el.getAttribute('aria-label'));
 await page.mouse.move(clip.x+clip.width/2,clip.y+clip.height/2);await page.mouse.down();await page.mouse.move(clip.x+clip.width/2,topRow.y-12,{steps:15});await wait(100);
 const topGuide=await insertionGuide();assert.ok(topGuide&&topGuide.text==='New visual layer'&&Math.abs(topGuide.y-topRow.y)<4,`Top insertion indicator must be visible: ${JSON.stringify(topGuide)}`);await page.mouse.up();await wait(200);
 assert.ok(await page.$(`.timeline-track[data-group="visual"][data-layer="${top+1}"]`),`Dragging above V${top} must create V${top+1}`);
 assert.equal((await page.$$(`.timeline-track[data-group="visual"][data-layer="${top+1}"] .timeline-clip`)).length,1,'Dragged clip must land on the new top layer');
 const after=await page.$eval(`.timeline-track[data-group="visual"][data-layer="${top+1}"] .timeline-clip`,el=>el.getAttribute('aria-label'));
 assert.equal(after.replace(`V${top+1}`,'V1'),before,'Drag up must preserve timing and duration');
 await page.click('[aria-label="Undo"]');await wait(100);assert.deepEqual(await visualRows(),initialRows,'Undo must remove the new layer');
 const v1Count=(await page.$$('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip')).length;
 const lowerRow=await rect('.timeline-track[data-group="visual"][data-layer="1"]');const lowerClip=await rect('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip');
 await page.mouse.move(lowerClip.x+lowerClip.width/2,lowerClip.y+lowerClip.height/2);await page.mouse.down();// V1 touches A1, so the new-layer target is the ±6px seam band (6190119, 1db5bf9).
 await page.mouse.move(lowerClip.x+lowerClip.width/2,lowerRow.y+lowerRow.height+3,{steps:15});await wait(100);
 const bottomGuide=await insertionGuide();assert.ok(bottomGuide&&bottomGuide.text==='New visual layer'&&Math.abs(bottomGuide.y-(lowerRow.y+lowerRow.height))<4,`Bottom insertion indicator must be visible: ${JSON.stringify(bottomGuide)}`);await page.mouse.up();await wait(200);
 assert.equal((await page.$$('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip')).length,1,'Dragging below must create a new bottom V1');
 assert.equal((await page.$$('.timeline-track[data-group="visual"][data-layer="2"] .timeline-clip')).length,v1Count-1,'Other footage clips must move to V2 intact');
 assert.equal((await visualRows()).length,initialRows.length+1,'Dragging below adds exactly one visual layer');
 const lowerLabel=await page.$eval('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip',el=>el.getAttribute('aria-label'));assert.equal(lowerLabel,before);
 await page.click('[aria-label="Undo"]');await wait(100);assert.deepEqual(await visualRows(),initialRows,'Undo restores the original layers');
 // Same-row overlaps are rejected in place with a drop hint since 5a84c22; new rows come only from edge/seam drops.
 const second=await page.$$('.timeline-track[data-group="visual"][data-layer="1"] .timeline-clip');const secondRect=await second[1].boundingBox();
 const labelsBefore=await page.$$eval('.timeline-clip',nodes=>nodes.map(node=>node.getAttribute('aria-label')));const undoBefore=await page.$eval('[aria-label="Undo"]',el=>el.disabled);
 await page.mouse.move(secondRect.x+secondRect.width/2,secondRect.y+secondRect.height/2);await page.mouse.down();await page.mouse.move(secondRect.x-secondRect.width/2,secondRect.y+secondRect.height/2,{steps:15});await wait(100);
 assert.equal(await page.$eval('.timeline-drop-hint',el=>getComputedStyle(el).display!=='none'&&el.textContent),'Overlaps a clip','Overlapping drag shows an inline drop hint');
 await page.mouse.up();await wait(200);
 assert.deepEqual(await visualRows(),initialRows,'Overlapping drop must not create a layer');
 assert.deepEqual(await page.$$eval('.timeline-clip',nodes=>nodes.map(node=>node.getAttribute('aria-label'))),labelsBefore,'Overlapping drop leaves every clip in place');
 assert.equal(await page.$eval('[aria-label="Undo"]',el=>el.disabled),undoBefore,'A rejected drop adds no undo entry');
 assert.equal(await page.$('.editor-error-bar'),null,'No overlap error bar should be shown');
 assert.ok(await page.$('.timeline-toolbar .timeline-playback-controls .preview-time'),'Time readout remains in timeline'); // The shell's transport renders inside the timeline toolbar.
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,dragCreatesTopAndBottom:true,timingPreserved:true,undoRemovesLayer:true,visibleInsertionIndicators:true,collisionRejectedInPlace:true,transportInTimeline:true}));
}finally{await browser.close();}
