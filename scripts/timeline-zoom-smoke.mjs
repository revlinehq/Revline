import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { TIMELINE_MAX_ZOOM } from '../lib/editor/timeline-zoom.ts'; // 16 since 4436053
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--ignore-certificate-errors']});
try {
 const page=await browser.newPage();await page.setViewport({width:1440,height:1000});await page.goto('http://localhost:3001/dev/editor',{waitUntil:'networkidle2'});
 await page.waitForSelector('.timeline-scroll');
 const burst=async (count,delta)=>page.evaluate(async({count,delta})=>{
  const el=document.querySelector('.timeline-scroll');let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber$'))],store;
  while(f){if(f.memoizedProps?.store?.getState?.().timeline){store=f.memoizedProps.store;break;}f=f.return;}
  const before=store.getState().zoom,r=el.getBoundingClientRect();
  for(let i=0;i<count;i++)el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,ctrlKey:true,deltaY:delta,clientX:r.left+120,clientY:r.top+15}));
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const after=store.getState().zoom;return {before,after,px:parseFloat(document.querySelector('.time-ruler').style.getPropertyValue('--ruler-unit')),width:el.clientWidth,labels:[...document.querySelectorAll('.time-ruler span')].map(e=>e.textContent),ticks:document.querySelector('.ruler-ticks path').getAttribute('d').length};
 },{count,delta});
 const out=await burst(10,30);console.log(JSON.stringify({burstZoomOut:out}));assert.ok(Math.abs(out.after-out.before*Math.exp(-1))<.000001,'Rapid wheel zoom must accumulate every event');
 const back=await burst(10,-30);assert.ok(Math.abs(back.after-out.before)<.000001,'Reverse wheel input must restore scale');
 await page.focus('[aria-label="Timeline zoom"]');await page.keyboard.press('Home');await new Promise(r=>setTimeout(r,100));
 const overview=await burst(100,30);assert.ok(overview.width/overview.px>=14399,'Minimum zoom must show four hours');assert.ok(overview.labels.some(label=>label.includes('h')),'Hour overview needs hour labels');assert.ok(overview.labels.length<20&&overview.ticks<3000,'Overview must keep ruler work bounded');
 await page.keyboard.press('End');await new Promise(r=>setTimeout(r,100));const detail=await burst(1,-30);assert.equal(detail.after,TIMELINE_MAX_ZOOM,'Zoom in clamps exactly at detailed scale');
 console.log(JSON.stringify({passed:true,rapidZoomOut:out.after,rapidZoomIn:back.after,overviewHours:overview.width/overview.px/3600,overviewLabels:overview.labels,detailedScale:detail.after}));
}finally{await browser.close();}
