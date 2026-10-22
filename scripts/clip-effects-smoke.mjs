import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1600,height:1000});
const pause=()=>new Promise(resolve=>setTimeout(resolve,200));
const ready=async()=>{await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));await pause();};
const selected=()=>page.evaluate(()=>window.testStore.getState().timeline.clips.find(c=>c.id===window.testStore.getState().selectedId));
try {
 await page.goto(process.env.BASE_URL??'http://localhost:3001/dev/editor',{waitUntil:'networkidle2'});await ready();
 await page.evaluate(()=>{
  const el=document.querySelector('.timeline-scroll');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
  while(fiber){const store=fiber.memoizedProps?.store;if(store?.getState?.().timeline){window.testStore=store;break;}fiber=fiber.return;}
  const state=window.testStore.getState(),clip=state.timeline.clips.find(c=>c.kind==='video'||c.kind==='image');
  window.testFootage=JSON.stringify(clip);window.testFootageId=clip.id;window.testStore.setState({selectedId:clip.id,selectedIds:[clip.id]});
 });
 // Footage opens one Clip settings view with inline applied effects (c55d5b2, 10be298); no Edit / Effects tabs.
 // The editing panel starts collapsed to the floating tools rail (e832836).
 if(await page.$('[aria-label="Expand editing panel"]'))await page.click('[aria-label="Expand editing panel"]');await page.waitForSelector('.preview-inspector');
 if(await page.$('.inspector-library-heading button'))await page.click('.inspector-library-heading button');await pause();
 assert.equal(await page.$('#inspector-effects-tab'),null,'Footage has no separate Effects tab');
 assert.ok(await page.$('#inspector-effects .applied-visual-effects [aria-label="Add effect"]'),'Footage exposes compact visual effects');
 assert.equal(await page.$('select[aria-label="Blend mode"]'),null);
 assert.equal(await page.$('.clip-motion-presets'),null);
 await page.evaluate(()=>{const state=window.testStore.getState(),clip=state.timeline.clips.find(c=>c.kind==='graphic');window.testStore.setState({selectedId:clip.id,selectedIds:[clip.id]});});
 // Text animations live in the Animation view of the combined text settings (aef76cd).
 await page.waitForSelector('#text-settings-animation-tab');await page.click('#text-settings-animation-tab');await page.waitForSelector('[aria-label="Text animations"]');
 assert.deepEqual((await page.$$eval('[aria-label="Text animations"] .text-animation-card',cards=>cards.map(card=>card.getAttribute('aria-label')))).slice(0,4),['None','Fade','Rise','Pop in']);
 for (const [label,animation] of [['Fade','fade'],['Rise','rise']]) {
  await page.click(`[aria-label="Apply ${label}"]`);await pause();await ready();
  const clip=await selected();assert.equal(clip.animation,animation);assert.deepEqual(clip.motion,[]);
 }
 await page.click('[aria-label="Apply Pop in"]');await pause();await ready();
 const pop=await selected();assert.equal(pop.animation,'none');assert.ok(pop.motion.length>1);
 const scale=await page.evaluate(({id,start,time})=>{const p=document.querySelector('hyperframes-player');p.seek(start+time);const index=window.testStore.getState().timeline.clips.findIndex(c=>c.id===id),doc=p.iframeElement.contentDocument;return new DOMMatrix(doc.defaultView.getComputedStyle(doc.getElementById(`clip-${index}-motion`)).transform).a;},{id:pop.id,start:pop.start,time:pop.motion[1].time});
 assert.ok(scale>1.03&&scale<1.09,`Text pop renders at its keyframe: ${scale}`);
 await page.click('[aria-label="Apply None"]');await pause();await ready();
 const none=await selected();assert.equal(none.animation,'none');assert.deepEqual(none.motion,[]);
 assert.equal(await page.evaluate(()=>JSON.stringify(window.testStore.getState().timeline.clips.find(c=>c.id===window.testFootageId))),await page.evaluate(()=>window.testFootage),'Text effects never mutate footage');
 assert.equal(await page.evaluate(()=>window.testStore.getState().timeline.clips.filter(c=>c.kind==='effect').length),0,'Text buttons never create visual effect clips');
 await page.screenshot({path:'/tmp/revline-text-effects.png'});
 await page.evaluate(()=>{const state=window.testStore.getState();state.edit({...state.timeline,clips:[...state.timeline.clips,{id:'saved-effect',kind:'effect',effectPreset:'flash',track:4,start:1,duration:1,sourceStart:0}]});window.testStore.setState({selectedId:'saved-effect',selectedIds:['saved-effect']});});await pause();await ready();
 assert.ok(await page.$('[data-clip-id="saved-effect"]'),'Existing saved effect still appears');
 // Saved Flash clips open their shared editable properties (4bef366) instead of a placeholder.
 if(await page.$('.inspector-library-heading button'))await page.click('.inspector-library-heading button');await pause();
 assert.ok(await page.$('#inspector-effects [aria-label="flash settings"]'),'Existing saved effect opens its settings');
 await page.focus('[data-clip-id="saved-effect"]');await page.keyboard.press('Delete');await pause();
 assert.equal(await page.$('[data-clip-id="saved-effect"]'),null,'Saved effect remains deletable');
 console.log('PASS: None/Fade/Rise/Pop update selected text, preserve footage, and keep existing saved visual effects editable and removable.');
}finally{await browser.close();}
