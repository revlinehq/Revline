import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome', headless:true, args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors'] });
const page = await browser.newPage(); await page.setViewport({width:1440,height:1001});
const errors=[], failures=[], results={}; page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'&&message.text().includes('passive'))errors.push(message.text());});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rect=selector=>page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
const expect=(condition,message)=>{if(!condition)failures.push(message);};
async function reset(){await page.goto('http://localhost:3001/dev/editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);}
try {
 await reset();
 const railLeft=(await rect('.track-headers')).x;
 for(let index=0;index<3;index++)await page.click('[aria-label="Zoom in"]');
 await page.$eval('.timeline-scroll',el=>el.scrollLeft=200);await wait(80);
 expect((await rect('.track-headers')).x===railLeft,'Track names must remain pinned while the timeline scrolls horizontally');
 // Ruler ticks sit on half pixels for crisp 1px lines (f0b874a), so the 0s label is origin + 0.5.
 const origin=await page.$eval('.time-ruler .ruler-origin-label',el=>parseFloat(el.style.left)-.5);
 expect(await page.$eval('.clip-video',el=>parseFloat(el.style.left))===origin&&await page.$eval('.playhead',el=>parseFloat(el.style.left))===origin,'Footage starting at zero must align with the shared marker origin');
 // Overlay rows merged into shared V tracks: the demo keeps graphics on V2 and captions on V3.
 const label=await rect('.track-label[data-group="visual"]');
 await page.mouse.move(label.x+label.width/2,label.y+label.height/2);await page.mouse.down();await wait(450);
 results.headerStationaryScroll=await page.$eval('.timeline-scroll',el=>el.scrollLeft);
 expect(Math.abs(results.headerStationaryScroll-200)<1,`Holding a layer header moved horizontal scroll from 200 to ${results.headerStationaryScroll}`);
 await page.keyboard.press('Escape');await page.mouse.up();

 await reset();
 const rowCount=await page.$$eval('.timeline-track[data-group="visual"]',rows=>rows.length);
 const captionLabel=await rect('.track-label[data-group="visual"][data-layer="3"]');
 const graphicLabel=await page.$eval('.track-label[data-group="visual"][data-layer="2"]',el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
 await page.mouse.move(graphicLabel.x+graphicLabel.width/2,graphicLabel.y+graphicLabel.height/2);await page.mouse.down();await page.mouse.move(graphicLabel.x+graphicLabel.width/2,captionLabel.y-8,{steps:12});await page.mouse.up();await wait(120);
 results.headerEdgeRows=await page.$$eval('.timeline-track[data-group="visual"]',rows=>rows.length);
 expect(results.headerEdgeRows===rowCount,`Reordering a layer past the top added a track (${rowCount} -> ${results.headerEdgeRows})`);
 expect((await page.$$('.timeline-track[data-group="visual"][data-layer="3"] .clip-graphic')).length===2,'Dragging the graphic header above captions should reorder the existing row');
 await page.click('[aria-label="Undo"]');await wait(100);
 expect((await page.$$('.timeline-track[data-group="visual"][data-layer="2"] .clip-graphic')).length===2,'One undo restores the original graphic row');

 await reset();
 for(let index=0;index<3;index++)await page.click('[aria-label="Zoom in"]');
 await page.click('[aria-label="Toggle snapping"]');
 await page.$eval('.timeline-scroll',el=>el.scrollLeft=150);await wait(80);
 const handle=await rect('.clip-graphic .clip-trim.right'),before=await rect('.clip-graphic');
 const beforeLabel=await page.$eval('.clip-graphic',el=>el.getAttribute('aria-label'));
 await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2+10,handle.y+handle.height/2,{steps:3});await wait(80);
 const gestureZoom=await page.$eval('[aria-label="Timeline zoom"]',el=>el.value);
 await page.keyboard.down('Control');await page.mouse.wheel({deltaY:-120});await page.keyboard.up('Control');await wait(80);
 expect(await page.$eval('[aria-label="Timeline zoom"]',el=>el.value)===gestureZoom,'Ctrl-wheel must not change gesture coordinates during an active trim');
 const liveBeforeScroll=await rect('.clip-graphic');
 await page.$eval('.timeline-scroll',el=>el.scrollLeft+=100);await wait(100);
 const liveAfterScroll=await rect('.clip-graphic');
 results.trimManualScroll={before:before.width,liveBeforeScroll:liveBeforeScroll.width,liveAfterScroll:liveAfterScroll.width};
 expect(Math.abs(liveAfterScroll.width-liveBeforeScroll.width-100)<4,'Manual horizontal scroll during edge resizing must update the live clip width without another pointer move');
 await page.mouse.up();await wait(120);const committed=await rect('.clip-graphic');
 expect(Math.abs(committed.width-liveAfterScroll.width)<2,'Mouse release should commit the current visible trim instead of jumping');
 await page.click('[aria-label="Undo"]');await wait(80);
 expect(await page.$eval('.clip-graphic',el=>el.getAttribute('aria-label'))===beforeLabel,'One undo restores the entire scroll and trim gesture');

 await reset();
 const video=await rect('.clip-video');
 await page.mouse.move(video.x+video.width/2,video.y+8);await page.mouse.down();await page.mouse.move(video.x+video.width/2+12,video.y+8,{steps:3});await wait(80);
 const ghost=await rect('.timeline-floating-clip');results.grabOffset={originalTop:video.y,ghostTop:ghost.y};
 expect(Math.abs(video.y-ghost.y)<1,'Dragging from near the clip top must preserve the grab position without a vertical jump');
 await page.keyboard.press('Escape');await page.mouse.up();

 await reset();
 for(let index=0;index<6;index++){
   await page.click('[aria-label="Add timeline layer"]');await page.waitForSelector('[role="menuitem"]');
   await page.evaluate(()=>[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Visual layer').click());
   await page.waitForSelector('[role="menuitem"]',{hidden:true});
 }
 await page.$eval('.timeline-scroll',el=>el.scrollTop=0);await wait(80);
 const rail=await rect('.track-headers');
 await page.mouse.move(rail.x+rail.width/2,rail.y+60);await page.mouse.wheel({deltaY:120});await wait(120);
 results.headerWheel=await page.evaluate(()=>({viewport:document.querySelector('.timeline-scroll').scrollTop,rail:document.querySelector('.track-headers').scrollTop}));
 expect(results.headerWheel.viewport>0,'Wheel scrolling over track names must scroll the timeline');
 expect(results.headerWheel.viewport===results.headerWheel.rail,'Track names and lanes must stay aligned after wheel scrolling');
 const zoomBefore=await page.$eval('[aria-label="Timeline zoom"]',el=>Number(el.value));
 await page.keyboard.down('Control');await page.mouse.wheel({deltaY:-120});await page.keyboard.up('Control');await wait(80);
 expect(await page.$eval('[aria-label="Timeline zoom"]',el=>Number(el.value))>zoomBefore,'Ctrl-wheel over the track rail should zoom the timeline when no gesture is active');

 results.verticalTiming=[];
 for(const caption of ['A little more outside.','A little less on your phone.']){
   await reset();const selector=`.clip-caption[aria-label^="${caption}"]`;
   const clip=await rect(selector),row=await rect('.timeline-track[data-group="visual"][data-layer="3"]');
   const before=await page.$eval(selector,el=>parseFloat(el.style.left));
   await page.mouse.move(clip.x+clip.width/2,clip.y+clip.height/2);await page.mouse.down();await page.mouse.move(clip.x+clip.width/2,row.y-8,{steps:12});await page.mouse.up();await wait(100);
   const after=await page.$eval(selector,el=>parseFloat(el.style.left));results.verticalTiming.push({caption,before,after});
   expect(Math.abs(after-before)<.01,`Moving ${caption} straight up changed its horizontal start by ${after-before}px`);
 }
 expect(errors.length===0,`Page errors: ${errors.join(', ')}`);
 console.log(JSON.stringify({passed:failures.length===0,results,failures}));
 assert.deepEqual(failures,[]);
} finally {await browser.close();}
