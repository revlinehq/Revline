import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();
await page.setViewport({width:1600,height:1000});
const pause=()=>new Promise(resolve=>setTimeout(resolve,150));
const snapshot=()=>page.evaluate(()=>{const {timeline,playhead}=window.testStore.getState();return {markers:timeline.markers??[],playhead,clips:timeline.clips};});
try{
  await page.goto(process.env.BASE_URL??'http://localhost:3001/dev/editor',{waitUntil:'networkidle2'});
  await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
  await page.evaluate(()=>{
    const el=document.querySelector('.timeline-scroll');let fiber=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))];
    while(fiber){const store=fiber.memoizedProps?.store;if(store?.getState?.().timeline){window.testStore=store;break;}fiber=fiber.return;}
    window.testPreviewDocument=document.querySelector('hyperframes-player').iframeElement.contentDocument;
  });
  const ruler=await page.$eval('.time-ruler',el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,px:parseFloat(el.style.getPropertyValue('--ruler-unit'))};});
  await page.mouse.click(ruler.left+3*ruler.px,ruler.top+24);
  await page.keyboard.press('m');await pause();
  assert.equal((await snapshot()).markers.length,1);
  assert.equal((await snapshot()).markers[0].time,3);
  await page.keyboard.press('m');await pause();
  assert.equal((await snapshot()).markers.length,1,'M at same frame must not duplicate marker');
  assert.equal(await page.evaluate(()=>window.testPreviewDocument===document.querySelector('hyperframes-player').iframeElement.contentDocument),true,'Marking must not rebuild preview');
  // A marker added with M sits under the playhead cap (z-index above markers since 29c5837), so grab
  // a visible part of the marker rather than its center.
  const markerPoint=()=>page.$eval('[data-marker-id]',el=>{const r=el.getBoundingClientRect();for(const [dx,dy] of [[12,10],[12,4],[4,14],[22,14],[4,4],[22,4]])if(document.elementFromPoint(r.left+dx,r.top+dy)?.closest('[data-marker-id]')===el)return {x:r.left+dx,y:r.top+dy};return null;});
  const marker=await markerPoint();
  assert.ok(marker,'A new marker under the playhead remains grabbable');
  await page.mouse.move(marker.x,marker.y);await page.mouse.down();
  await page.mouse.move(marker.x+2*ruler.px,marker.y,{steps:15});await page.mouse.up();await pause();
  assert.equal((await snapshot()).markers[0].time,5);
  assert.equal((await snapshot()).playhead,5);
  await page.keyboard.press('ArrowRight');await pause();
  assert.ok(Math.abs((await snapshot()).markers[0].time-(5+1/30))<1e-6);
  await page.mouse.click(ruler.left+ruler.px,ruler.top+24);await pause();
  const moved=await markerPoint();
  await page.mouse.click(moved.x,moved.y);await pause();
  assert.ok(Math.abs((await snapshot()).playhead-(5+1/30))<1e-6,'Clicking orange marker seeks');
  const menuPoint=await markerPoint();assert.ok(menuPoint,'The marker stays reachable after seeking onto it');
  await page.mouse.click(menuPoint.x,menuPoint.y,{button:'right'});
  await page.waitForSelector('[role=menuitem]');
  await page.evaluate(()=>[...document.querySelectorAll('[role=menuitem]')].find(el=>el.textContent.includes('Rename marker')).click());
  await page.waitForSelector('input[aria-label="Marker name"]');
  await page.focus('input[aria-label="Marker name"]');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type('Main drop');await page.keyboard.press('Enter');await pause();
  assert.equal((await snapshot()).markers[0].label,'Main drop');
  await page.screenshot({path:'/tmp/revline-beat-markers.png'});
  await page.focus('[data-marker-id]');const clips=(await snapshot()).clips.length;
  await page.keyboard.press('Delete');await pause();
  assert.equal((await snapshot()).markers.length,0);assert.equal((await snapshot()).clips.length,clips,'Deleting marker never deletes clips');
  await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');await pause();
  assert.equal((await snapshot()).markers[0].label,'Main drop','Undo restores marker');
  await page.focus('.edit-composer textarea');await page.keyboard.type('m');await pause();
  assert.equal((await snapshot()).markers.length,1,'Typing M must not create a marker');
  console.log('PASS: M add/deduplicate, stable preview, frame drag/nudge, click seek, rename, delete/undo, and text-input guard.');
}finally{await browser.close();}
