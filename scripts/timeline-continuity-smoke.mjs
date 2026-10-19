import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1001});const errors=[];page.on('pageerror',e=>errors.push(e.message));const wait=ms=>new Promise(r=>setTimeout(r,ms));
const rect=selector=>page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
try{
 await page.goto('http://localhost:3001/dev/editor',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 await page.evaluate(()=>{window.originalPreview=document.querySelector('hyperframes-player');window.blankFrames=0;window.observePreview=new MutationObserver(()=>{if(!window.originalPreview.isConnected||document.querySelector('.preview-loading'))window.blankFrames++;});window.observePreview.observe(document.querySelector('.preview-canvas'),{subtree:true,childList:true});});
 const row=await rect('.timeline-track[data-group="visual"]');const clip=await rect('.clip-video');
 await page.mouse.move(clip.x+clip.width/2,clip.y+clip.height/2);await page.mouse.down();await page.mouse.move(clip.x+clip.width/2,row.y-12,{steps:15});await page.mouse.up();await wait(400);
 const continuity=await page.evaluate(()=>({samePlayer:window.originalPreview===document.querySelector('hyperframes-player'),blankFrames:window.blankFrames}));
 console.log(JSON.stringify({continuity}));await page.click('[aria-label="Undo"]');await wait(300);
 for(let i=0;i<7;i++){await page.click('[aria-label="Add timeline layer"]');await page.waitForSelector('[role="menuitem"]');await page.evaluate(()=>Array.from(document.querySelectorAll('[role="menuitem"]')).find(el=>el.textContent==='Overlay layer').click());await wait(200);}
 const handle=await rect('[aria-label="Resize preview and timeline"]');await page.mouse.move(handle.x+handle.width/2,handle.y);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y+60,{steps:12});await page.mouse.up();await wait(150);
 const visible=await page.evaluate(()=>{const s=document.querySelector('.timeline-scroll');const r=s.getBoundingClientRect();return {height:r.height,scroll:s.scrollTop,occupied:Array.from(s.querySelectorAll('.timeline-clip')).filter(el=>{const b=el.getBoundingClientRect();return b.bottom>r.top+22&&b.top<r.bottom;}).length};});
 console.log(JSON.stringify({continuity,visible}));assert.ok(continuity.samePlayer&&continuity.blankFrames===0,'Vertical clip moves must keep the preview mounted, without a loading flash');assert.ok(visible.occupied>0,'Shrinking timeline must retain occupied tracks instead of showing only empty rows');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,previewNeverReloadsOnLayerMove:true,occupiedTracksVisibleOnResize:true}));
}finally{await browser.close();}
