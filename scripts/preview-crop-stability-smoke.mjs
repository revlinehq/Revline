import assert from 'node:assert/strict';
import { calculateVisualRect, generateComposition } from '../lib/editor/composition.ts';
import { applyTwoRowLayout } from '../lib/editor/two-row-layout.ts';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require=createRequire(process.cwd()+'/package.json');
const puppeteer=(await import(pathToFileURL(require.resolve('puppeteer')).href)).default;

if(process.env.REVLINE_TWO_ROW_ONLY==='1'){
  const sharp=(await import('sharp')).default;
  const assets=[{_id:'support',kind:'image',fileName:'support.svg',url:'http://fixture.local/support.svg',width:1920,height:1080},{_id:'narrator',kind:'image',fileName:'narrator.svg',url:'http://fixture.local/narrator.svg',width:1080,height:1920}];
  const timeline=applyTwoRowLayout({aspectRatio:'vertical',fps:30,clips:assets.map((asset,index)=>({id:asset._id,assetId:asset._id,kind:'image',track:index+1,start:0,duration:2,sourceStart:0}))},assets,{topClipIds:['support'],bottomClipIds:['narrator']});
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(String(error)));await page.setViewport({width:1080,height:1920});await page.setRequestInterception(true);
    let composition='';
    page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/')void request.respond({status:200,contentType:'text/html',body:composition});else if(path.endsWith('.svg')){const source=assets.find(asset=>new URL(asset.url).pathname===path);void request.respond({status:200,contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${source.width}" height="${source.height}"><rect width="100%" height="100%" fill="${source._id==='support'?'rgb(220,40,40)':'rgb(40,80,220)'}"/></svg>`});}else if(path.startsWith('/vendor/'))void request.respond({status:200,contentType:'application/javascript',body:readFileSync(join(process.cwd(),'public',path))});else void request.abort();});
    for(const preview of [true,false]){
      composition=generateComposition(timeline,assets,{preview,gsapUrl:'http://fixture.local/vendor/gsap.min.js'});
      await page.goto('http://fixture.local/',{waitUntil:'networkidle0'});await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
      const bounds=await page.evaluate(()=>[...document.querySelectorAll('.source-window')].map(node=>{const r=node.getBoundingClientRect();return{left:r.left,top:r.top,width:r.width,height:r.height}}));
      for(const [index,rect]of bounds.entries()){assert.ok(Math.abs(rect.left)<.01);assert.ok(Math.abs(rect.top-index*960)<.01);assert.ok(Math.abs(rect.width-1080)<.01);assert.ok(Math.abs(rect.height-960)<.01);}
      const {data,info}=await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({resolveWithObject:true});
      for(const [y,color]of [[0,[220,40,40]],[959,[220,40,40]],[960,[40,80,220]],[1919,[40,80,220]]]){const offset=(y*info.width+540)*info.channels;assert.deepEqual([...data.subarray(offset,offset+3)],color,`Exact ${preview?'preview':'export'} row coverage at y=${y}`);}
    }
    assert.deepEqual(errors,[]);console.log('PASS: real preview and export composition paint exact undistorted top/bottom rows with no gap or overlap.');
  }finally{await browser.close();}
  process.exit(0);
}

const directory = mkdtempSync(join(tmpdir(), 'revline-live-effects-'));
const fixture = join(directory, 'footage.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:a', 'aac', '-b:a', '96k', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fixture]);
const demoUrl = new URL(process.env.BASE_URL ?? 'http://localhost:3001/dev/editor');
assert.ok(['localhost', '127.0.0.1'].includes(demoUrl.hostname) && demoUrl.pathname === '/dev/editor', 'Run only the isolated local in-memory demo');
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors', '--enable-unsafe-swiftshader'] });
const context = await browser.createBrowserContext();
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', error => browserErrors.push(String(error)));
page.on('console', message => { if (message.type() === 'error' && message.text().includes('Revline visual effects')) browserErrors.push(message.text()); });
await page.setRequestInterception(true);
page.on('request', request => ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? request.continue() : request.abort());
await page.setViewport({ width: 1600, height: 1000 });
const settle = () => new Promise(resolve => setTimeout(resolve, 250));
try {
  await page.goto(demoUrl.href, { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    const element = document.querySelector('.timeline-scroll');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    while (fiber) {
      const store = fiber.memoizedProps?.store;
      if (store?.getState?.().timeline) { window.testStore = store; break; }
      fiber = fiber.return;
    }
    const state = window.testStore.getState();
    state.edit({ ...state.timeline, clips: [], markers: [] });
  });
  await settle();
  await page.click('.empty-upload button');
  await page.waitForSelector('input[type="file"]');
  await (await page.$('input[type="file"]')).uploadFile(fixture);
  await page.waitForFunction(() => window.testStore.getState().timeline.clips.some(clip => clip.kind === 'video'));
  await page.waitForFunction(() => document.querySelector('hyperframes-player')?.ready && document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('video')?.readyState >= 2);
  await settle();
  await page.evaluate(() => {
    const p = document.querySelector('hyperframes-player'); p.seek(2);
    const video=p.iframeElement.contentDocument.querySelector('video');
    const clip=window.testStore.getState().timeline.clips.find(c=>c.kind==='video');
    window.testStore.setState({selectedId:clip.id,selectedIds:[clip.id],playhead:2});
    window.baseline={p,doc:p.iframeElement.contentDocument,video,images:[...document.querySelectorAll('.timeline-clip .filmstrip-frame img')]};
    window.loads=0;video.addEventListener('loadstart',()=>window.loads++);
    window.playerAdds=0;window.playerObserver=new MutationObserver(entries=>{for(const e of entries)for(const n of e.addedNodes)if(n.tagName==='HYPERFRAMES-PLAYER')window.playerAdds++;});
    window.playerObserver.observe(document.querySelector('.hyperframes-host'),{childList:true});
  });
  await page.click('#inspector-edit-tab');
  await page.click('.inspector-transform');
  await page.waitForSelector('[aria-label="Crop left. Use arrow keys to adjust."]');
  await page.focus('[aria-label="Crop left. Use arrow keys to adjust."]');
  await page.keyboard.down('Shift');await page.keyboard.press('ArrowRight');await page.keyboard.up('Shift');
  await page.click('.source-crop-actions button:last-child');
  await new Promise(resolve=>setTimeout(resolve,900));
  const result=await page.evaluate(()=>{
    const p=[...document.querySelectorAll('hyperframes-player')].find(n=>n.style.zIndex==='1');
    const images=[...document.querySelectorAll('.timeline-clip .filmstrip-frame img')];
    return {crop:window.testStore.getState().timeline.clips.find(c=>c.kind==='video').crop,samePlayer:p===window.baseline.p,sameDocument:p?.iframeElement.contentDocument===window.baseline.doc,sameVideo:p?.iframeElement.contentDocument.querySelector('video')===window.baseline.video,playerAdds:window.playerAdds,loads:window.loads,thumbnailIdentity:images.length>0&&images.length===window.baseline.images.length&&images.every((n,i)=>n===window.baseline.images[i]),thumbnailCount:images.length};
  });
  console.log(JSON.stringify(result));
  assert.ok(result.crop.left>0,'The actual crop gesture commits');
  assert.equal(result.samePlayer,true,'Cropping must keep the existing decoded player');
  assert.equal(result.sameDocument,true,'Cropping must keep the existing iframe document');
  assert.equal(result.sameVideo,true,'Cropping must keep the decoded source video');
  assert.equal(result.playerAdds,0,'A crop must not mount a replacement player');
  assert.equal(result.thumbnailIdentity,true,'Crop must keep existing timeline thumbnails');
  assert.deepEqual(browserErrors,[]);
  const wait=()=>new Promise(resolve=>setTimeout(resolve,150));
  await page.click('.inspector-transform');
  await page.waitForSelector('[data-crop-handle="n"]');
  const bounds=await page.$eval('.source-crop-bounds',n=>{const r=n.getBoundingClientRect();return{w:r.width,h:r.height};});
  const drag=async(handle,dx,dy)=>{const n=await page.$(`[data-crop-handle="${handle}"]`);const r=await n.boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+dx,r.y+r.height/2+dy,{steps:10});await page.mouse.up();await wait();};
  const draft=()=>page.$eval('.source-crop-selection',n=>({left:parseFloat(n.style.left)/100,top:parseFloat(n.style.top)/100,width:parseFloat(n.style.width)/100,height:parseFloat(n.style.height)/100}));
  await drag('n',0,bounds.h*.92);const narrow=await draft();
  assert.ok(narrow.top>.91,'Narrow vertical crop established');
  await drag('n',0,-bounds.h*.15);const expanded=await draft();
  assert.ok(Math.abs(expanded.top-.77)<.002,'The intended top edge expands when hit areas overlap');
  assert.ok(Math.abs(expanded.top+expanded.height-1)<.002,'Top adjustment preserves the bottom edge');
  await drag('nw',bounds.w*.9,0);const corner=await draft();
  assert.ok(corner.left>.93&&Math.abs(corner.top-expanded.top)<.002,'Corner cropping adjusts X independently of Y');
  await drag('nw',-bounds.w*.18,-bounds.h*.12);const expandedCorner=await draft();
  assert.ok(Math.abs(expandedCorner.left-(corner.left-.18))<.002&&Math.abs(expandedCorner.top-(corner.top-.12))<.002,'A narrow corner expands both independent axes');
  await page.click('.source-crop-actions button:first-of-type');await wait();
  await drag('s',0,-bounds.h*.92);const narrowBottom=await draft();
  assert.ok(narrowBottom.height<.081&&narrowBottom.top===0,'Narrow bottom crop established');
  await drag('s',0,bounds.h*.15);const expandedBottom=await draft();
  assert.ok(Math.abs(expandedBottom.height-.23)<.002&&expandedBottom.top===0,'Bottom edge expands without moving top');
  await page.click('.source-crop-actions button:last-child');await wait();
  const snapshot=()=>page.evaluate(()=>{const p=document.querySelector('hyperframes-player');const doc=p.iframeElement.contentDocument,video=doc.querySelector('video');return{samePlayer:p===window.baseline.p,sameVideo:video===window.baseline.video,players:document.querySelectorAll('hyperframes-player').length,paused:p.paused,muted:p.muted,sourceMuted:video.muted,time:doc.defaultView.__timelines.revline.time(),width:parseFloat(video.style.width),left:parseFloat(video.style.left)};});
  const patch=async(value)=>{await page.evaluate(value=>{const s=window.testStore.getState();s.edit({...s.timeline,clips:s.timeline.clips.map(c=>c.kind==='video'?{...c,...value}:c)});},value);await wait();};
  await page.evaluate(()=>{const p=document.querySelector('hyperframes-player');p.muted=false;window.testStore.setState({muted:false});p.play();});await wait();
  const playing=await snapshot();assert.equal(playing.paused,false);assert.equal(playing.sourceMuted,false,'Source audio is audible before crop changes');
  await patch({crop:{left:.1,right:.05,top:.1,bottom:.05},fit:'contain'});
  await patch({colorGrade:{enabled:true,exposure:.3,contrast:1,saturation:1,temperature:0,tint:0,vibrance:0}});
  const updated=await snapshot();assert.equal(updated.samePlayer,true);assert.equal(updated.sameVideo,true);assert.equal(updated.paused,false);assert.equal(updated.sourceMuted,false);assert.ok(updated.time>playing.time,'The existing composition clock continues through crop and effect commits');
  await page.evaluate(()=>{const p=document.querySelector('hyperframes-player');p.pause();p.seek(0);});
  await page.evaluate(()=>window.beforeFocusPlayer=document.querySelector('hyperframes-player'));
  await patch({focus:[{time:0,x:.3,y:.4},{time:12,x:.7,y:.6}],fit:'cover'});
  await page.waitForFunction(()=>document.querySelector('hyperframes-player')!==window.beforeFocusPlayer&&document.querySelector('hyperframes-player')?.style.zIndex==='1'&&document.querySelector('hyperframes-player')?.ready&&document.querySelector('hyperframes-player')?.iframeElement?.contentDocument?.querySelector('video')?.readyState>=2);
  await page.evaluate(()=>{const p=document.querySelector('hyperframes-player');window.baseline={p,doc:p.iframeElement.contentDocument,video:p.iframeElement.contentDocument.querySelector('video')};});
  const focusedCrop={left:.2,right:.05,top:.05,bottom:.1};await patch({crop:focusedCrop});
  await page.evaluate(()=>document.querySelector('hyperframes-player').seek(6));await wait();
  const canvas=await page.evaluate(()=>{const c=document.querySelector('hyperframes-player').iframeElement.contentDocument.getElementById('composition');return{w:Number(c.dataset.width),h:Number(c.dataset.height)};});
  const focused=await snapshot(),firstRect=calculateVisualRect(320,180,canvas.w,canvas.h,focusedCrop,{x:.3,y:.4},'cover'),lastRect=calculateVisualRect(320,180,canvas.w,canvas.h,focusedCrop,{x:.7,y:.6},'cover');
  const expectedLeft=((firstRect.left-firstRect.window.left)+(lastRect.left-lastRect.window.left))/2;
  assert.equal(focused.samePlayer,true);assert.equal(focused.sameVideo,true);assert.ok(Math.abs(focused.left-expectedLeft)<1,'Live crop retains focus tween geometry at the same clock position');
  assert.deepEqual(browserErrors,[]);
  console.log('PASS: actual crop commit retains player/document/native source/timeline thumbnails; narrow top and bottom remain adjustable; corners resize independently; crop and effects keep playback/audio running; tracked crop geometry matches export at a seek.');
} finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
