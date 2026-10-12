import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1001});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const errors=[],failures=[];page.on('pageerror',error=>errors.push(error.message));
const expect=(condition,message)=>{if(!condition)failures.push(message);};
const marker=()=>page.$eval('.playhead',el=>new DOMMatrix(getComputedStyle(el).transform).m41);
async function clipPoint(index){const clips=await page.$$('.clip-video');const bounds=await clips[index].boundingBox();return {x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};}
async function clickClip(index,button='left'){const point=await clipPoint(index);await page.mouse.click(point.x,point.y,{button});await wait(100);}
try{
 await page.goto('http://localhost:3001/editor/demo',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);
 const ruler=await page.$eval('.time-ruler',el=>{const r=el.getBoundingClientRect();const origin=parseFloat(el.querySelector('span').style.left);const labels=[...el.querySelectorAll('span')];return {x:r.x+origin+54*2,y:r.y+4};});
 await page.mouse.click(ruler.x,ruler.y);await wait(100);const parked=await marker();
 await clickClip(6);expect(Math.abs(await marker()-parked)<.01,'Selecting footage outside the current frame must leave the playhead parked');
 expect((await page.$$('.clip-video.selected')).length===1,'Click still selects the footage');
 await (await page.$('.timeline-panel')).screenshot({path:'/tmp/revline-custom-selection-preserves-playhead.png'});
 await page.keyboard.down('Shift');await clickClip(7);await page.keyboard.up('Shift');
 expect((await page.$$('.clip-video.selected')).length===2,'Shift-click still adds a clip to the selection');
 expect(Math.abs(await marker()-parked)<.01,'Shift-selection must not seek');
 await clickClip(8,'right');await page.keyboard.press('Escape');expect(Math.abs(await marker()-parked)<.01,'Right-clicking footage must not seek');
 const last=await page.$$('.clip-video');await last[8].focus();await page.keyboard.press('Enter');await wait(100);expect(Math.abs(await marker()-parked)<.01,'Keyboard clip selection must not seek');
 const caption=await page.$('.clip-caption');const captionBounds=await caption.boundingBox();await page.mouse.click(captionBounds.x+captionBounds.width/2,captionBounds.y+captionBounds.height/2,{count:2,delay:40});await page.waitForSelector('.quick-text-dialog',{timeout:5000});
 expect(Math.abs(await marker()-parked)<.01,'Opening text editing must not seek');await page.keyboard.press('Escape');await page.waitForSelector('.quick-text-dialog',{hidden:true});
 expect(await page.$eval('[aria-label="Undo"]',el=>el.disabled),'Selection and opening controls must not create undo entries');
 const empty=await page.$eval('.timeline-track[data-group="audio"]',el=>{const r=el.getBoundingClientRect();return {x:r.x+8+54*9.2,y:r.y+25};});await page.mouse.click(empty.x,empty.y);await wait(100);
 expect(Math.abs(await marker()-parked)>50,'Clicking empty timeline space must still seek');
 await page.click('[aria-label="Play (Space)"]');await wait(180);const runningBefore=await marker();await clickClip(8);await wait(180);
 expect(!!await page.$('[aria-label="Pause (Space)"]'),'Selecting a different clip during playback must not pause');
 expect(await marker()>runningBefore,'Playback continues advancing after clip selection');
 if(await page.$('[aria-label="Pause (Space)"]'))await page.click('[aria-label="Pause (Space)"]');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:failures.length===0,parked,failures}));assert.deepEqual(failures,[]);
}finally{await browser.close();}
