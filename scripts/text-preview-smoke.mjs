import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function box(selector){return page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});}
async function caption(){return page.evaluate(()=>{const players=[...document.querySelectorAll('hyperframes-player')];const p=players.find(p=>p.style.zIndex==='1');const e=p.iframeElement.contentDocument.querySelector('.caption');return {x:parseFloat(e.style.left),y:parseFloat(e.style.top),font:parseFloat(e.style.fontSize),player:p.id||p.getAttribute('data-smoke-player')};});}
try{
 await page.goto('http://localhost:3001/dev/editor',{waitUntil:'networkidle2'});await page.waitForSelector('.text-controls');const ruler=await box('.time-ruler');await page.mouse.click(ruler.x+54,ruler.y+10);await page.waitForSelector('[aria-label="Move text: A little more outside."]');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Move text: A little more outside."]').getBoundingClientRect().width>20);
 const selector='[aria-label="Move text: A little more outside."]',initial=await caption();let rect=await box(selector);
 // The first press selects unselected text; dragging moves selected text (81b883d, 477ea58).
 await page.mouse.click(rect.x+rect.w/2,rect.y+rect.h/2);await page.waitForFunction(s=>document.querySelector(s).getAttribute('aria-pressed')==='true',{},selector);assert.deepEqual(await caption(),initial,'Selecting text does not move it');rect=await box(selector);
 await page.mouse.move(rect.x+rect.w/2,rect.y+rect.h/2);await page.mouse.down();await page.mouse.move(rect.x+rect.w/2+30,rect.y+rect.h/2-45,{steps:10});
 const live=await caption();assert.ok(live.x>initial.x&&live.y<initial.y,'Direct text drag did not update the rendered text');
 assert.equal(await page.$eval('[aria-label="Undo"]',e=>e.disabled),true,'Drag committed before release');
 await page.mouse.up();await pause(400);
 const moved=await caption();assert.ok(moved.x>initial.x&&moved.y<initial.y);
 await page.click('[aria-label="Undo"]');await pause(400);assert.equal((await caption()).x,initial.x);assert.equal((await caption()).y,initial.y);assert.equal(await page.$eval('[aria-label="Undo"]',e=>e.disabled),true,'Drag created multiple undo entries');
 // Select, enlarge with a corner, and undo exactly once.
 rect=await box(selector);await page.mouse.click(rect.x+rect.w/2,rect.y+rect.h/2);await page.waitForSelector('[aria-label="Resize text bottom right"]');
 const handles=await page.$eval(selector,element=>{const bounds=element.getBoundingClientRect();return [...element.querySelectorAll('.visual-corner')].map(handle=>{const square=handle.querySelector('span').getBoundingClientRect();return {name:handle.getAttribute('aria-label'),cursor:getComputedStyle(handle).cursor,outside:(square.right<=bounds.left||square.left>=bounds.right)&&(square.bottom<=bounds.top||square.top>=bounds.bottom)};});});
 for(const handle of handles){assert.match(handle.cursor,/^(nwse|nesw)-resize$/,`${handle.name} has the wrong cursor`);assert.equal(handle.outside,true,`${handle.name} square should be outside the text`);}
 let corner=await box('[aria-label="Resize text bottom right"]');
 await page.mouse.move(corner.x+corner.w/2,corner.y+corner.h/2);await page.mouse.down();await page.mouse.move(corner.x+corner.w/2+20,corner.y+corner.h/2+10,{steps:8});assert.ok((await caption()).font>initial.font);await page.mouse.up();await pause(400);await page.click('[aria-label="Undo"]');await pause(400);assert.equal((await caption()).font,initial.font);
 // Escape discards an in-progress pointer edit.
 rect=await box(selector);await page.mouse.move(rect.x+rect.w/2,rect.y+rect.h/2);await page.mouse.down();await page.mouse.move(rect.x+rect.w/2-20,rect.y+rect.h/2-20,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();assert.equal((await caption()).x,initial.x);assert.equal(await page.$eval('[aria-label="Undo"]',e=>e.disabled),true);
 rect=await box(selector);await page.mouse.click(rect.x+rect.w/2,rect.y+rect.h/2,{count:2});await page.waitForSelector('textarea[aria-label="Edit text in preview"]');// Double click edits inline in the preview (477ea58).
 assert.equal(await page.$eval('textarea[aria-label="Edit text in preview"]',e=>e.value),'A little more outside.');await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('textarea[aria-label="Edit text in preview"]'));
 // The ruler uses the editor UI font token (--font-ui, Inter inside the editor) with tabular numerals (app/editor.css).
 const {font,uiFont,numeric}=await page.$eval('.time-ruler',e=>{const probe=document.createElement('span');probe.style.fontFamily='var(--font-ui)';e.append(probe);const uiFont=getComputedStyle(probe).fontFamily;probe.remove();return {font:getComputedStyle(e).fontFamily,uiFont,numeric:getComputedStyle(e).fontVariantNumeric};});
 assert.ok(uiFont.toLowerCase().includes('inter')&&font.startsWith(uiFont),'Timeline counter uses the editor UI font: '+font);assert.equal(numeric,'tabular-nums','Timeline counter uses tabular numerals');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,directDrag:true,livePreview:true,cornerResize:true,oneUndoPerGesture:true,escapeCancel:true,doubleClickEdit:true,font}));
}finally{await browser.close();}
