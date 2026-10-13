import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();await page.setViewport({width:1440,height:960});
try {
 await page.goto('http://localhost:3001/editor/demo',{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
 await page.evaluate(()=>{
  const el=document.querySelector('.timeline-scroll');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
  while(fiber){const store=fiber.memoizedProps?.store;if(store?.getState?.().timeline){window.testStore=store;break;}fiber=fiber.return;}
  const state=window.testStore.getState(),clip=state.timeline.clips.find(c=>c.kind==='video'||c.kind==='image');
  window.testClip=clip;window.testStore.setState({selectedId:clip.id,selectedIds:[clip.id]});
 });
 await page.click('#inspector-effects-tab');
 await page.locator('::-p-text(Punch zoom)').click();
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading')&&document.querySelector('hyperframes-player').iframeElement?.contentDocument.querySelector('[id$="-motion"]')?.style.transform);
 const sample=async(t)=>page.evaluate(t=>{
   const player=document.querySelector('hyperframes-player');player.seek(window.testClip.start+t);
   const index=window.testStore.getState().timeline.clips.findIndex(c=>c.id===window.testClip.id);
   const doc=player.iframeElement.contentDocument, node=doc.getElementById(`clip-${index}-motion`);
   return {scale: new DOMMatrix(doc.defaultView.getComputedStyle(node).transform).a, count:window.testStore.getState().history.length};
 },t);
 await new Promise(r=>setTimeout(r,300));
 const hit=await sample(.105), rest=await sample(.4), replay=await sample(.105);
 assert.ok(Math.abs(hit.scale-1.2)<.02,JSON.stringify(hit));assert.ok(Math.abs(rest.scale-1)<.01,JSON.stringify(rest));assert.deepEqual(hit,replay);
 await page.select('select[aria-label="Blend mode"]','screen');
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
 assert.equal(await page.evaluate(()=>window.testStore.getState().timeline.clips.find(c=>c.id===window.testClip.id).blendMode),'screen');
 await page.screenshot({path:'/tmp/revline-effects-controls.png'});
 console.log('PASS: effects UI applies punch zoom, playback seek/reverse seek match, and overlay blend selection persists in timeline.');
}finally{await browser.close();}
