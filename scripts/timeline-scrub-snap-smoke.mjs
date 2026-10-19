import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const heldOnly=process.argv.includes('--held');
const heldProof={cases:[],errors:[]};
page.on('pageerror',error=>heldProof.errors.push(error.message));
const flush=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function heldScrubChecks(){
 await page.evaluate(()=>{const node=document.querySelector('.timeline-scroll');let fiber=node[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];while(fiber){if(fiber.memoizedProps?.store?.getState){window.scrubStore=fiber.memoizedProps.store;break}fiber=fiber.return}if(!window.scrubStore)throw Error('Actual demo editor store not found');window.scrubEvents=[];for(const type of ['pointerdown','pointermove','pointercancel','pointerup','gotpointercapture','lostpointercapture'])document.addEventListener(type,event=>window.scrubEvents.push({type,id:event.pointerId,x:event.clientX,y:event.clientY,buttons:event.buttons,time:performance.now(),target:String(event.target.className)}),true);window.addEventListener('blur',()=>window.scrubEvents.push({type:'blur',time:performance.now()}));});
 const geometry=()=>page.evaluate(()=>{const view=document.querySelector('.timeline-scroll').getBoundingClientRect(),ruler=document.querySelector('.time-ruler').getBoundingClientRect(),preview=document.querySelector('.preview-canvas').getBoundingClientRect();return{left:view.left,right:view.right,top:view.top,rulerY:ruler.top+10,previewY:preview.top+preview.height/2}});
 const read=pointer=>page.evaluate(pointer=>{const scroll=document.querySelector('.timeline-scroll'),view=scroll.getBoundingClientRect(),state=window.scrubStore.getState(),head=document.querySelector('.playhead'),box=head.getBoundingClientRect(),px=parseFloat(document.querySelector('.time-ruler').style.getPropertyValue('--ruler-unit')),node=document.querySelector('.timeline-track .timeline-clip[data-clip-id]'),clip=state.timeline.clips.find(clip=>clip.id===node.dataset.clipId),origin=parseFloat(node.style.left)-clip.start*px,end=Math.max(...state.timeline.clips.map(clip=>clip.start+clip.duration)),expectedTime=pointer?Math.max(0,Math.min(end,Math.round((pointer.x-view.left+scroll.scrollLeft-origin)/px*state.timeline.fps)/state.timeline.fps)):null,player=document.querySelector('hyperframes-player'),clock=player.iframeElement.contentWindow.__timelines.revline;return{pointer,viewLeft:view.left,viewTop:view.top,viewBottom:view.bottom,scroll:scroll.scrollLeft,px,expectedTime,expectedX:pointer?view.left+origin+expectedTime*px-scroll.scrollLeft+.5:null,markerX:box.left+box.width/2,store:state.playhead,native:(clock.__hfReal??clock).time(),scrubbing:state.scrubbing,history:state.history.length}},pointer);
 const setup=async zoom=>{await page.evaluate(zoom=>window.scrubStore.setState({zoom}),zoom);await flush();await page.$eval('.timeline-scroll',(node,zoom)=>node.scrollLeft=zoom===1?0:500,zoom);await flush();};
 const grab=async()=>{const g=await geometry();await page.mouse.click((g.left+g.right)/2,g.rulerY);await flush();const before=await read(null),cap=await page.$eval('.timeline-playhead-cap',node=>{const box=node.getBoundingClientRect();return{x:box.left+box.width/2,y:box.top+5}});await page.mouse.move(cap.x,cap.y);await page.mouse.down();return before;};
 await setup(1);const rapidBefore=await grab(),rapidGeometry=await geometry(),rapid=[];const started=Date.now();let index=0,last;
 while(Date.now()-started<1100){last={x:rapidGeometry.left+(rapidGeometry.right-rapidGeometry.left)*(index%2?.78:.22),y:[rapidGeometry.rulerY,rapidGeometry.previewY,45][index%3]};await page.mouse.move(last.x,last.y);await flush();rapid.push(await read(last));index++;}
 await page.mouse.up();await flush();const rapidAfter=await read(last);heldProof.cases.push({name:'rapid-cross-panel',elapsedMs:Date.now()-started,samples:rapid,after:rapidAfter});
 assert.ok(rapid.every(sample=>sample.scrubbing&&Math.abs(sample.markerX-sample.expectedX)<=2),'Held rapid cross-panel drag must follow the cursor frame in current viewport pixels');assert.equal(rapidAfter.scrubbing,false,'Release exits scrub mode');assert.equal(rapidAfter.history,rapidBefore.history,'Scrubbing never creates edit history');
 for(const side of ['left','right'])for(const inside of [false,true]){
  await setup(4);const before=await grab(),g=await geometry(),pointer={x:side==='left'?g.left+1:g.right-1,y:inside?g.rulerY:g.top-100};await page.mouse.move(pointer.x,pointer.y);await flush();const samples=[];
  for(let frame=0;frame<10;frame++){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));samples.push(await read(pointer));}
  await page.mouse.up();await flush();const after=await read(pointer),drift=samples.at(-1).scroll-samples[0].scroll;heldProof.cases.push({name:side+(inside?'-inside':'-above'),pointer,samples,drift,after});
  assert.equal(after.scrubbing,false,'Edge release exits scrub mode');assert.equal(after.history,before.history);
  if(inside)assert.ok(side==='left'?drift < -20:drift > 20,'Held pointer inside the '+side+' ruler edge must still auto-scroll');
  else{assert.ok(Math.abs(drift)<=1,'Stationary held pointer above the '+side+' timeline edge must not scroll');assert.ok(Math.abs(samples.at(-1).store-samples[0].store)<1/30,'Above-timeline hold must not drift source time');}
 }
 await setup(4);const beforeEscape=await grab(),g=await geometry();await page.mouse.move(g.left+(g.right-g.left)*.25,g.previewY);await flush();await page.keyboard.press('Escape');await page.mouse.up();await flush();const escaped=await read(null);heldProof.cases.push({name:'cross-panel-escape',before:beforeEscape,after:escaped});assert.equal(escaped.scrubbing,false);assert.ok(Math.abs(escaped.store-beforeEscape.store)<1/30&&Math.abs(escaped.native-beforeEscape.native)<1/30,'Escape outside the timeline restores the original paused position');assert.deepEqual(heldProof.errors,[]);
 console.log(JSON.stringify({passed:true,rapidSamples:rapid.length,maxCursorErrorPx:Math.max(...rapid.map(sample=>Math.abs(sample.markerX-sample.expectedX))),edges:heldProof.cases.filter(item=>item.drift!==undefined).map(({name,drift})=>({name,drift})),crossPanelRelease:true,crossPanelEscape:true}));
}
try{
 await page.goto('http://localhost:3001/dev/editor',{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.querySelector('hyperframes-player')?.ready&&!document.querySelector('.preview-loading'));
 if(heldOnly){await heldScrubChecks();}else{
 await page.focus('[aria-label="Timeline zoom"]');await page.keyboard.press('End');
 for(let step=0;step<10;step++)await page.keyboard.press('ArrowLeft');
 await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Timeline zoom"]').value)===90);await flush();
 const source=await page.evaluate(()=>{
  const ruler=document.querySelector('.time-ruler').getBoundingClientRect();
  const px=parseFloat(document.querySelector('.time-ruler').style.getPropertyValue('--ruler-unit'));
  const firstVideo=document.querySelector('.clip-video');
  const origin=parseFloat(firstVideo.style.left);
  const viewport=document.querySelector('.timeline-scroll').getBoundingClientRect();
  return {left:ruler.left,top:ruler.top,origin,px,edge:(parseFloat(firstVideo.style.left)-origin+parseFloat(firstVideo.style.width))/px,viewportLeft:viewport.left,viewportRight:viewport.right};
 });
 for(const value of [1.017,source.edge+.02]){const x=source.left+source.origin+source.px*value;assert.ok(x>source.viewportLeft+80&&x<source.viewportRight-80,'Frame-precision targets must stay outside the auto-scroll edge bands');}
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
 }
}finally{if(heldOnly){heldProof.events=await page.evaluate(()=>window.scrubEvents??[]).catch(()=>[]);await writeFile('/tmp/revline-scrub-held-trace.json',JSON.stringify(heldProof,null,2));}await browser.close();}
