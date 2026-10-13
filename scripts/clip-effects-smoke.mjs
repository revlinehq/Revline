import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1600,height:1000});
const pause=()=>new Promise(resolve=>setTimeout(resolve,200));
const effects=()=>page.evaluate(()=>window.testStore.getState().timeline.clips.filter(clip=>clip.kind==='effect'));
const ready=async()=>{await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));await pause();};
try {
 await page.goto(process.env.BASE_URL??'http://localhost:3001/editor/demo',{waitUntil:'networkidle2'});await ready();
 await page.evaluate(()=>{
  const el=document.querySelector('.timeline-scroll');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
  while(fiber){const store=fiber.memoizedProps?.store;if(store?.getState?.().timeline){window.testStore=store;break;}fiber=fiber.return;}
  const state=window.testStore.getState(),clip=state.timeline.clips.find(c=>c.kind==='video'||c.kind==='image');
  window.testClip=clip;window.testStore.setState({selectedId:clip.id,selectedIds:[clip.id]});
 });
 const ruler=await page.$eval('.time-ruler',el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,px:parseFloat(el.style.getPropertyValue('--ruler-unit'))};});
 await page.mouse.click(ruler.left+4*ruler.px,ruler.top+24);
 await page.click('#inspector-effects-tab');await page.locator('::-p-text(Punch zoom)').click();
 await page.waitForFunction(()=>window.testStore.getState().timeline.clips.some(clip=>clip.kind==='effect'));await ready();
 let [effect]=await effects();assert.equal(effect.start,4);assert.equal(effect.effectPreset,'punch');
 assert.equal(await page.evaluate(()=>window.testStore.getState().timeline.clips.find(c=>c.id===window.testClip.id).motion),undefined,'Adding effect never changes footage motion');
 const sample=async(t,id=effect.id)=>page.evaluate(({t,id})=>{const p=document.querySelector('hyperframes-player');p.seek(t);const doc=p.iframeElement.contentDocument,node=doc.querySelector(`[data-effect-clip="${id}"]`);return new DOMMatrix(doc.defaultView.getComputedStyle(node).transform).a;},{t,id});
 assert.ok(Math.abs(await sample(0)-1)<.001,'Effect must not start at source beginning');
 const peak=await sample(effect.start+effect.motion[1].time);assert.ok(peak>1.16&&peak<=1.201,`Punch peak: ${peak}; ${JSON.stringify(effect)}`);
 assert.ok(Math.abs(await sample(effect.start+effect.duration+.1)-1)<.001,'Effect ends at its own range');
 const box=await page.$eval(`[data-clip-id="${effect.id}"]`,el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
 await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x+2*ruler.px,box.y,{steps:15});await page.mouse.up();await pause();
 [effect]=await effects();assert.equal(effect.start,6,'Effect drags independently');await ready();
 const right=await page.$eval(`[data-clip-id="${effect.id}"] .clip-trim.right`,el=>{const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
 await page.mouse.move(right.x,right.y);await page.mouse.down();await page.mouse.move(right.x+ruler.px,right.y,{steps:10});await page.mouse.up();await pause();
 [effect]=await effects();assert.ok(Math.abs(effect.duration-1.5)<.001,'Effect duration trims independently');assert.equal(effect.sourceStart,0);await ready();
 await page.locator('::-p-text(Cinematic bars)').click();await pause();await ready();
 [effect]=await effects();assert.equal(effect.effectPreset,'cinematic-bars');assert.equal(effect.start,6);
 await page.locator('::-p-text(Add another at playhead)').click();await pause();await ready();
 assert.equal((await effects()).length,2,'Explicit add creates second independent clip');
 await page.screenshot({path:'/tmp/revline-effect-clips.png'});
 console.log('PASS: independent amber effects start at playhead, leave source unchanged, render only within range, drag, switch presets and add another.');
}finally{await browser.close();}
