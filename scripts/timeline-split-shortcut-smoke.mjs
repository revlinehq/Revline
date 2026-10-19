import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
const page=await browser.newPage();
await page.setViewport({width:1440,height:960});
const state=()=>page.evaluate(()=>{
  let fiber=document.querySelector('.timeline-scroll')[Object.keys(document.querySelector('.timeline-scroll')).find(k=>k.startsWith('__reactFiber$'))];
  while(fiber){const store=fiber.memoizedProps?.store;if(store?.getState?.().timeline){window.testStore=store;break;}fiber=fiber.return;}
  const {timeline,selectedId,playhead}=window.testStore.getState();return {clips:timeline.clips,selectedId,playhead,focus:document.activeElement?.tagName};
});
try{
  await page.goto(process.env.BASE_URL??'http://localhost:3001/dev/editor',{waitUntil:'networkidle2'});
  await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
  const original=await state();
  const first=original.clips.find(c=>c.kind==='video'||c.kind==='image');
  await page.evaluate(id=>window.testStore.setState({selectedId:id,selectedIds:[id]}),first.id);
  await page.focus('.edit-composer textarea');
  const ruler=await page.$eval('.time-ruler',el=>{const r=el.getBoundingClientRect();return {left:r.left,top:r.top,px:parseFloat(el.style.getPropertyValue('--ruler-unit'))};});
  await page.mouse.click(ruler.left+1*ruler.px+10,ruler.top+10);
  await page.keyboard.press('s');
  await new Promise(r=>setTimeout(r,350));
  const cut=await state();
  assert.equal(cut.clips.length,original.clips.length+1,`S after composer → ruler must split: ${JSON.stringify({before:original.clips.length,after:cut.clips.length,focus:cut.focus,playhead:cut.playhead})}`);
  assert.equal(await page.$eval('.custom-timeline',el=>getComputedStyle(el).outlineStyle),'none');
  console.log('PASS: S splits after typing in composer and seeking on ruler.');
}finally{await browser.close();}
