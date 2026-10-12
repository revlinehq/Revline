import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1001});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function rect(selector){return page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});}
async function menu(label,item){await page.click(`[aria-label="${label}"]`);await page.waitForSelector('[role="menuitem"]');await page.evaluate(text=>{const el=[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent===text);if(!el||el.getAttribute('data-disabled')!==null)throw new Error(`Unavailable menu item ${text}`);el.click();},item);await pause(200);}
try{
 await page.goto('http://localhost:3001/editor/demo',{waitUntil:'networkidle2'});await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);await pause(300);
 await menu('Options for A1','Delete empty layer');if(await page.$('[aria-label="Options for A1"]'))throw new Error('Empty audio layer remained');
 await menu('Options for O1','Move layer up');await menu('Options for O2','Move layer up');if(!await page.$('[aria-label="Options for O3"]'))throw new Error('O3 not created');
 // Move the first graphic from O3 to the newly empty O2, then back up by pointer.
 let clip=await rect('.timeline-clip.clip-graphic');let dest=await rect('.timeline-track[data-group="overlay"][data-layer="2"]');
 await page.mouse.move(clip.x+clip.w/2,clip.y+clip.h/2);await page.mouse.down();await page.mouse.move(clip.x+clip.w/2,dest.y+dest.h/2,{steps:12});await page.mouse.up();await pause(400);
 if(!await page.$('.timeline-track[data-group="overlay"][data-layer="2"] .clip-graphic'))throw new Error('Clip drag down failed');
 clip=await rect('.timeline-track[data-layer="2"] .clip-graphic');dest=await rect('.timeline-track[data-group="overlay"][data-layer="3"]');
 await page.mouse.move(clip.x+clip.w/2,clip.y+clip.h/2);await page.mouse.down();await page.mouse.move(clip.x+clip.w/2,dest.y+dest.h/2,{steps:12});await page.mouse.up();await pause(400);
 if(!await page.$('.timeline-track[data-group="overlay"][data-layer="3"] .clip-graphic'))throw new Error('Clip drag up failed '+await page.evaluate(()=>JSON.stringify({rows:[...document.querySelectorAll('.timeline-track')].map(el=>({layer:el.dataset.layer,clips:[...el.querySelectorAll('.timeline-clip')].map(c=>c.textContent)})),error:document.querySelector('.editor-error-bar')?.textContent})));
 // Reorder the whole layer using its header.
 const header=await rect('[aria-label="Options for O3"]');dest=await rect('.timeline-track[data-group="overlay"][data-layer="2"]');
 await page.mouse.move(header.x-24,header.y+header.h/2);await page.mouse.down();await page.mouse.move(header.x-24,dest.y+dest.h/2,{steps:12});await page.mouse.up();await pause(300);
 if((await page.$$('.timeline-track[data-group="overlay"][data-layer="2"] .clip-graphic')).length!==2)throw new Error('Whole layer reorder failed');
 // Compact rows + collapse/expand.
 await page.click('[aria-label="Compact track rows"]');const dense=await rect('.timeline-track');if(dense.h!==28)throw new Error('Compact rows did not shrink');await page.click('[aria-label="Expand track rows"]');
 await page.click('[aria-label="Collapse timeline"]');await pause(100);if(await page.$eval('.timeline-body',el=>getComputedStyle(el).display)!=='none')throw new Error('Collapse failed');await page.click('[aria-label="Expand timeline"]');await pause(150);
 // Resize upward: line must cover all available height and triangle remain above ruler.
 const divider=await rect('[aria-label="Resize preview and timeline"]');await page.mouse.move(divider.x+divider.w/2,divider.y+divider.h/2);await page.mouse.down();await page.mouse.move(divider.x+divider.w/2,divider.y-220,{steps:15});await page.mouse.up();await pause(200);
 const dynamic=await page.evaluate(()=>{const head=document.querySelector('.playhead'),scroll=document.querySelector('.timeline-scroll'),triangle=document.querySelector(".timeline-playhead-cap");return {line:head.getBoundingClientRect().height,viewport:scroll.clientHeight,headZ:Number(getComputedStyle(head).zIndex),rulerZ:Number(getComputedStyle(document.querySelector('.time-ruler')).zIndex),triangle:triangle.getBoundingClientRect().height,grid:getComputedStyle(document.querySelector('.timeline-track')).backgroundImage};});
 if(dynamic.line<dynamic.viewport||dynamic.headZ<=dynamic.rulerZ||dynamic.triangle<10||dynamic.grid!=='none')throw new Error(`Dynamic timeline failed ${JSON.stringify(dynamic)}`);
 // Box-select several clips from empty space without including lower rows.
 const area=await rect('.timeline-track-area');const row=await rect('.timeline-track[data-group="overlay"][data-layer="1"]');
 const origin=await page.$eval('.time-ruler span',el=>parseFloat(el.style.left));
 await page.mouse.move(area.x+origin+12,row.y+row.h-2);await page.mouse.down();await page.mouse.move(area.x+origin+380,row.y+5,{steps:15});await page.mouse.up();await pause(150);
 const selected=await page.$$eval('.timeline-clip.selected',els=>els.map(el=>({label:el.getAttribute('aria-label'),track:el.parentElement.dataset.group})));
 if(selected.length<2||selected.some(c=>c.track!=='overlay'))throw new Error(`Box selection failed ${JSON.stringify(selected)}`);
 // Drag selected captions together to an empty upper layer.
 const first=await rect('.timeline-track[data-group="overlay"][data-layer="1"] .timeline-clip');const upper=await rect('.timeline-track[data-group="overlay"][data-layer="3"]');
 await page.mouse.move(first.x+first.w/2,first.y+first.h/2);await page.mouse.down();await page.mouse.move(first.x+first.w/2,upper.y+upper.h/2,{steps:14});await page.mouse.up();await pause(200);
 if((await page.$$('.timeline-track[data-group="overlay"][data-layer="3"] .clip-caption')).length!==selected.length)throw new Error('Group move failed');
 // Ctrl+A then bulk Delete and Undo.
 await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');const total=await page.$$eval('.timeline-clip',els=>els.length);const selectedAll=await page.$$eval('.timeline-clip.selected',els=>els.length);if(total!==selectedAll)throw new Error('Select all failed');
 await page.keyboard.press('Delete');await pause(200);if((await page.$$('.timeline-clip')).length)throw new Error('Bulk delete failed');await page.click('[aria-label="Undo (Ctrl+Z)"]');await pause(200);if((await page.$$('.timeline-clip')).length!==total)throw new Error('Bulk undo failed');
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready);await page.evaluate(()=>document.querySelector('hyperframes-player').seek(0));await page.click('[aria-label="Play (Space)"]');
 const motion=await page.evaluate(()=>new Promise(resolve=>{const positions=[];function sample(){positions.push(new DOMMatrix(getComputedStyle(document.querySelector('.playhead')).transform).m41);if(positions.length<45)requestAnimationFrame(sample);else resolve({distinct:new Set(positions.map(x=>x.toFixed(2))).size,backward:positions.some((x,i)=>i>0&&x<positions[i-1]-.01),distance:positions.at(-1)-positions[0]});}requestAnimationFrame(sample);}));
 await page.click('[aria-label="Pause (Space)"]');if(motion.distinct<25||motion.backward||motion.distance<15)throw new Error(`Playhead motion failed ${JSON.stringify(motion)}`);
 await page.screenshot({path:'design/implementation/timeline-expanded.png'});
 if(errors.length)throw new Error(errors.join('\n'));console.log(JSON.stringify({passed:true,emptyDelete:true,clipDragUpDown:true,headerReorder:true,compactCollapse:true,dynamic,boxSelection:selected.length,bulkDeleteUndo:true,groupMove:true,motion,errors}));
}finally{await browser.close();}
