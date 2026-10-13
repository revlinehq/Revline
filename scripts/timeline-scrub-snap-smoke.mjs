import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
const browser=await puppeteer.launch({executablePath:'/home/sonic/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 await page.goto('http://localhost:3001/editor/demo',{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
 await page.focus('[aria-label="Timeline zoom"]');await page.keyboard.press('End');
 await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Timeline zoom"]').value)===100);
 const source=await page.evaluate(()=>{
  const ruler=document.querySelector('.time-ruler').getBoundingClientRect();
  const px=parseFloat(document.querySelector('.time-ruler').style.getPropertyValue('--ruler-unit'));
  const firstVideo=document.querySelector('.clip-video');
  const origin=parseFloat(firstVideo.style.left);
  return {left:ruler.left,top:ruler.top,origin,px,edge:(parseFloat(firstVideo.style.left)-origin+parseFloat(firstVideo.style.width))/px};
 });
 const undoInitiallyDisabled=await page.$eval('[aria-label="Undo"]',el=>el.disabled);
 const read=()=>page.evaluate(({origin,px})=>{
  const x=new DOMMatrix(getComputedStyle(document.querySelector('.playhead')).transform).m41;
  const counter=document.querySelector('.preview-time').textContent;
  const [minutes,seconds,frames]=counter.split('/')[0].trim().split(':').map(Number);
  return {markerTime:(x-origin)/px,previewTime:minutes*60+seconds+frames/30,counter};
 },source);
 const begin=async(value,delay=100)=>{
  const cap=await page.$eval('.timeline-playhead-cap',el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+10};});
  await page.mouse.move(cap.x,cap.y);await page.mouse.down();
  await page.mouse.move(source.left+source.origin+source.px*value,source.top+10,{steps:4});
  if(delay)await wait(delay);
  return read();
 };
 const verify=(sample,expected,label)=>{
  assert.ok(Math.abs(sample.previewTime*30-Math.round(sample.previewTime*30))<0.001,`${label}: preview must be frame aligned ${JSON.stringify(sample)}`);
  assert.ok(Math.abs(sample.markerTime-sample.previewTime)<0.001,`${label}: marker must show the previewed frame ${JSON.stringify(sample)}`);
  assert.ok(Math.abs(sample.markerTime-expected)<0.001,`${label}: incorrect snap ${JSON.stringify(sample)}`);
 };
 const far=await begin(1.017);verify(far,31/30,'Away from edges');assert.ok(far.counter.startsWith('00:01:01'));
 await page.mouse.up();
 const near=await begin(source.edge+.02);verify(near,Math.round((source.edge+.02)*30)/30,'Ruler scrubbing ignores clip magnets');
 await page.mouse.up();
 await page.click('[aria-label="Toggle snapping"]');assert.equal(await page.$eval('[aria-label="Toggle snapping"]',el=>el.getAttribute('aria-pressed')),'false');
 const disabled=await begin(source.edge+.02);verify(disabled,Math.round((source.edge+.02)*30)/30,'Clip snapping does not affect ruler frame precision');
 await page.mouse.up();
 await page.click('[aria-label="Toggle snapping"]');
 await page.keyboard.down('Alt');
 const bypass=await begin(source.edge+.02);verify(bypass,Math.round((source.edge+.02)*30)/30,'Alt preserves the same ruler frame precision');
 await page.mouse.up();await page.keyboard.up('Alt');
 const beforeCancel=await read();await begin(1.017);await page.keyboard.press('Escape');await page.mouse.up();await wait(100);
 verify(await read(),beforeCancel.previewTime,'Escape restores the previous position');
 await begin(1.417,0);await page.mouse.up();await wait(100);
 verify(await read(),Math.round(1.417*30)/30,'Pointer release commits its final position');
 assert.equal(await page.$eval('[aria-label="Undo"]',el=>el.disabled),undoInitiallyDisabled,'Scrubbing must not add edit history');
 await page.click('[aria-label="Play (Space)"]');await wait(100);
 await begin(1.017);await page.mouse.up();await wait(100);
 assert.equal(await page.$eval('hyperframes-player',el=>el.paused),true,'A scrub seek lands on a paused frame');
 assert.ok(await page.$('[aria-label="Play (Space)"]'),'Playback UI must reflect the paused state after scrubbing');
 console.log(JSON.stringify({passed:true,frames:far,nearClipEdge:near,snappingOff:disabled,altBypass:bypass,escapeRestoresPosition:true,finalPointerCommit:true,noEditHistory:true,scrubbingPausesState:true}));
}finally{await browser.close();}
