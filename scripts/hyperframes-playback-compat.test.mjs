import {guardPreviewBuffering} from '../lib/editor/preview-buffering.ts';
import {previewMediaReady,waitForPreviewMedia} from '../lib/editor/preview-readiness.ts';
import {warmPreviewMedia} from '../lib/editor/preview-media-warmup.ts';
import {createPlaybackOpeningGate} from '../lib/editor/editor-opening.ts';
import {MAX_PREVIEW_BYTES} from '../lib/editor/preview-source-cache.ts';
import {generateComposition} from '../lib/editor/composition.ts';
import {videoThumbnails,cachedVideoThumbnail} from '../lib/editor/video-thumbnails.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test, vi } from 'vitest';
import { patchHyperframesPlaybackRuntime, HYPERFRAMES_PLAYBACK_COMPAT_VERSION } from './hyperframes-playback-compat.mjs';

const upstream=readFileSync('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js','utf8');
test('initial large-original opening waits for its derivative, then never remounts playback for later additions',()=>{
  const gate=createPlaybackOpeningGate(),large={_id:'large',kind:'video',fileName:'Original.mp4',size:428851563,url:'https://original.invalid/video.mp4'};
  const timeline={fps:60,aspectRatio:'9:16',clips:[{id:'one-uncut-video',assetId:large._id,kind:'video',start:0,duration:121.381067}]};
  assert.deepEqual(gate(timeline,undefined),[],'An unresolved query does not mark the editor as opened');
  assert.deepEqual(gate(timeline,[large]),[large]);
  assert.deepEqual(gate({...timeline,clips:[{...timeline.clips[0],duration:100}]},[large]),[large],'Edits do not mistake original first-frame readiness for prepared playback');
  assert.deepEqual(gate(timeline,[{...large,previewUrl:'https://preview.invalid/video.mp4',previewSize:50038423}]),[]);
  const later={...large,_id:'added-later'};
  assert.deepEqual(gate({...timeline,clips:[...timeline.clips,{...timeline.clips[0],id:'later',assetId:later._id}]},[large,later]),[],'A mounted editor keeps its session while new sources prepare');
});
test('opening gate leaves small sources and unused originals alone',()=>{
  const small={_id:'small',kind:'video',fileName:'Small.mp4',size:MAX_PREVIEW_BYTES,url:'https://small.invalid/video.mp4'};
  const unused={...small,_id:'unused',size:MAX_PREVIEW_BYTES+1};
  const timeline={fps:30,aspectRatio:'16:9',clips:[{id:'small-clip',assetId:small._id,kind:'video',start:0,duration:3}]};
  assert.deepEqual(createPlaybackOpeningGate()(timeline,[small,unused]),[]);
  assert.deepEqual(createPlaybackOpeningGate()({...timeline,clips:[]},[unused]),[],'An empty project can open before future imports');
});
const patched=patchHyperframesPlaybackRuntime(upstream,HYPERFRAMES_PLAYBACK_COMPAT_VERSION);
const alignment=source=>source.slice(source.indexOf('Vd=c=>')+'Vd='.length,source.indexOf(',bs=()=>',source.indexOf('Vd=c=>')));
function run(source,time,rate,current=0){
  const writes=[];const nodes=['VIDEO','AUDIO'].map(tagName=>({tagName,isConnected:true,readyState:4,seeking:false,dataset:{start:'5.366666666666666',duration:'5.5',mediaStart:'59',playbackRate:String(rate)},hasAttribute:name=>name==='data-start',get currentTime(){return current},set currentTime(value){writes.push(value)}}));
  const align=vm.runInNewContext(`(${alignment(source)})`,{document:{querySelectorAll:()=>nodes},pe:()=>true,P:node=>Number(node.dataset.start),Ce:Number,Kt:(time,start,end)=>time>=start&&time<end,vt:node=>Number(node.dataset.mediaStart),$e:node=>Number(node.dataset.playbackRate)});
  align(time);return writes;
}
test('actual upstream helper misplaces middle 4x A/V while the compatibility helper agrees with source mapping',()=>{
  const target=59+(8-5.366666666666666)*4;
  assert.ok(run(upstream,8,4).every(value=>Math.abs(value-target)>7));
  assert.deepEqual(run(patched,8,4),[target,target]);
});
test('one-times speed stays correct and decoded frames inside transport tolerance are retained',()=>{
  const start=5.366666666666666;
  assert.deepEqual(run(patched,8,1),run(upstream,8,1));
  for(const rate of [1,1.5,4]){assert.deepEqual(run(patched,start+1/60,rate,59),[]);const writes=run(patched,start+3/60,rate,59);assert.equal(writes.length,2);assert.ok(writes.every(value=>Math.abs(value-(59+rate*3/60))<1e-10));}
  assert.deepEqual(run(patched,8,4,59+(8-start)*4),[]);
  assert.deepEqual(run(patched,12,4),[]);
});
test('patch is confined to alignment, clock selection, media drift correction and managed loading and rejects changed dependencies',()=>{
  const before=alignment(upstream),after=alignment(patched);
  assert.equal(patched.replace(after,before).replace('!pe(S)||!S.isConnected||h(S)||Number(S.dataset.volume??1)<=0||fl(S)','!pe(S)||!S.isConnected||h(S)||fl(S)').replace('if(!J&&!V&&!G&&X&&ne>Yt*(r.tagName==="AUDIO"&&e.playing?Math.abs(T):1)){','if(!J&&!V&&!G&&X&&ne>Yt){').replace('J=(r.tagName==="VIDEO"||r.tagName==="AUDIO"&&a&&!e.forceSync&&ne<=.1*Math.abs(T))&&!r.paused&&e.playing','J=r.tagName==="VIDEO"&&!r.paused&&e.playing').replace('r.volume=M,cl.set(r,M),e.onElementVolume?.(r,M,O);if(r.tagName==="AUDIO"&&M===0){r.paused||r.pause();ml(r);cl.set(r,M);continue}(t||e.isWebAudioOwned?.(r))','r.volume=M,cl.set(r,M),e.onElementVolume?.(r,M,O),(t||e.isWebAudioOwned?.(r))').replace('V=r.tagName==="AUDIO"&&r.paused&&e.playing&&ne>.001||d&&ne>.001||r.ended&&h&&ne>.001||j||ne>pl&&(G||Y||U),','V=d&&ne>.001||r.ended&&h&&ne>.001||j||ne>pl&&(G||Y||U),').replace('Qy=(c,p,y)=>{if(document.documentElement.dataset.revlineMediaLoading==="managed")return;','Qy=(c,p,y)=>{'),upstream);
  assert.throws(()=>patchHyperframesPlaybackRuntime(upstream,'0.8.145'),/Review/);
  assert.throws(()=>patchHyperframesPlaybackRuntime(upstream.replace('I=c-S+L','I=changed'),'0.8.144'),/Review/);
});


test('production range-seek replay resumes when Chromium stops filling a playable paused buffer below 1.5 seconds',()=>{
  const doc=new EventTarget();let bufferedEnd=73.5,plays=0;
  const media={tagName:'VIDEO',paused:true,networkState:2,dataset:{start:'17.6',end:'20.7333333333',duration:'3.1333333333',playbackRate:'1'},currentTime:73.841333,duration:99.987833,ended:false,seeking:true,readyState:1,buffered:{length:1,start:()=>73.481122,end:()=>bufferedEnd},hasAttribute:()=>true};
  doc.querySelectorAll=()=>[media];const player=new EventTarget();player.paused=false;
  player.pause=()=>{player.paused=true;player.dispatchEvent(new Event('pause'))};player.play=()=>{plays++;player.paused=false;player.dispatchEvent(new Event('play'))};
  const guard=guardPreviewBuffering(doc,player,()=>17.608);
  try{
    const waiting=new Event('waiting');Object.defineProperty(waiting,'target',{value:media});doc.dispatchEvent(waiting);
    assert.equal(guard.isBuffering(),true);
    media.seeking=false;media.readyState=3;bufferedEnd=75.175533;
    doc.dispatchEvent(new Event('canplay'));
    assert.equal(guard.isBuffering(),false,'Decoded 1.334s runway resumes even when the browser misleadingly reports NETWORK_LOADING');
    assert.equal(plays,1);assert.equal(player.paused,false);
    media.dataset.playbackRate='4';assert.equal(previewMediaReady(media,17.608),true,'Native source preload cannot be multiplied beyond its paused buffer cap for faster clips');
    media.dataset.playbackRate='1';
    bufferedEnd=74.122333;assert.equal(previewMediaReady(media,17.608),true,'Captured high-bitrate footage can suspend with only 281ms of decoded future frames');
    media.readyState=1;assert.equal(previewMediaReady(media,17.608),false,'Metadata alone never releases the hold');
    media.readyState=3;bufferedEnd=73.94;assert.equal(previewMediaReady(media,17.608),false,'Less than 150ms remains a real buffer wait');
  }finally{guard.dispose()}
});

test('initial readiness also responds when the browser suspends its bounded paused preload',async()=>{
  const doc=new EventTarget(),media=new EventTarget();let resolved=false;
  Object.assign(media,{tagName:'VIDEO',paused:true,networkState:2,dataset:{start:'0',end:'3',playbackRate:'1'},currentTime:73.841333,duration:99.987833,seeking:false,readyState:3,buffered:{length:1,start:()=>73.481122,end:()=>74.0}});
  doc.querySelectorAll=()=>[media];
  const pending=waitForPreviewMedia(doc,0,new AbortController().signal).then(()=>{resolved=true});
  await Promise.resolve();assert.equal(resolved,false);
  media.networkState=1;media.buffered.end=()=>75.175533;media.dispatchEvent(new Event('suspend'));await pending;
  assert.equal(resolved,true);
});

function repeatedAudioSync(source,rate,drift,forceSync=false,options={}){
  const writes=[],rates=[],actions=[],maps=Object.fromEntries(['ll','jo','Xr','cl','Jr'].map(key=>[key,new WeakMap()]));
  let current=0,playbackRate=rate,frame=0;
  const media={tagName:options.tagName??'AUDIO',isConnected:true,paused:options.paused??false,ended:false,volume:options.volume??options.volumes?.[0]??1,preload:'auto',ownerDocument:{},closest:()=>null,
    pause(){actions.push({action:'pause',frame});this.paused=true},play(){actions.push({action:'play',frame});this.paused=false;return Promise.resolve()},
    get playbackRate(){return playbackRate},set playbackRate(value){rates.push(value);playbackRate=value},
    get currentTime(){return current},set currentTime(value){actions.push({action:'seek',frame});writes.push(value);current=value}};
  const start=options.start??13.9,mediaStart=options.mediaStart??9.633333333333333;
  const clip={el:media,start,end:options.end??16,duration:2.1,mediaStart,rate,sourceDuration:options.sourceDuration??24.789333,volume:options.volume??options.volumes?.[0]??1,fades:options.fades};
  if(options.primed){maps.ll.set(media,drift);maps.jo.set(media,mediaStart);}
  const softCorrection=source.slice(source.indexOf('function ml('),source.indexOf('function tp('));
  const fadeHelpers=source.slice(source.indexOf('function rl('),source.indexOf('var Zn='));
  const sync=vm.runInNewContext(`var AE=.03,wE=.01;${fadeHelpers};${softCorrection};(${source.slice(source.indexOf('function tp('),source.indexOf('var Xt=',source.indexOf('function tp(')))})`,{
    ...maps,al:new WeakSet(),ul:new WeakSet(),er:new WeakSet(),
    Kt:(time,start,end)=>time>=start&&time<end,Bs:value=>value,Wn:(value,time)=>value*time,qr:()=>false,qn:()=>false,
    sl:value=>value,Qe:value=>value,Ff:()=>options.automation?.(frame)??null,$o:()=>false,jm:{fadeIn:0,fadeOut:0},pl:.5,Yt:.04,fl:()=>false,Qm:()=>{},vE:()=>{},It:()=>null,H:()=>{},
  });
  for(frame=0;frame<4;frame++){
    if(options.volumes)clip.volume=options.volumes[frame];
    const timeSeconds=(options.time??14.2)+frame/60;current=mediaStart+Math.max(0,timeSeconds-start)*rate-drift;
    sync({clips:[clip],timeSeconds,playing:options.playing??true,playbackRate:1,forceSync,cueAheadSeconds:1,getCompositionDuration:()=>28});
  }
  return {writes,rates,actions};
}

test('accelerated secondary audio does not repeatedly seek for normal timeline drift',()=>{
  assert.ok(repeatedAudioSync(upstream,4,.06).writes.length>0,'Captured 4x audio jitter reproduces in the upstream synchronizer');
  assert.deepEqual(repeatedAudioSync(patched,4,.06).writes,[],'15ms of timeline drift at 4x is normal decoder jitter');
  const correction=repeatedAudioSync(patched,4,.24);
  assert.deepEqual(correction.writes,[],'A real 60ms timeline drift is corrected without restarting decoded audio');
  assert.deepEqual(correction.rates,[4.12]);
  assert.ok(repeatedAudioSync(patched,4,.06,true).writes.length>0,'Explicit forced seeks remain exact');
});

test('active playing secondary audio corrects ordinary drift without restarting its decoder',()=>{
  for(const volume of [0,1]){
    assert.ok(repeatedAudioSync(upstream,1,.06,false,{volume}).writes.length>0,'The actual upstream helper repeatedly seeks at both native volumes');
    const result=repeatedAudioSync(patched,1,.06,false,{volume});
    assert.deepEqual(result.writes,[],'A stable 60ms audio drift must not cause repeated currentTime assignments');
    assert.deepEqual(result.rates,volume===0?[]:[1.03],'Silent audio is paused; audible audio catches up without discarding decoded samples');
  }
});

test('already-playing secondary audio hard-aligns large stable offsets after preroll',()=>{
  const options={start:10.0333333333,end:13.2333333333,mediaStart:0,sourceDuration:3.2,time:11.563,primed:true};
  const result=repeatedAudioSync(patched,1,-1.597,false,options);
  assert.ok(result.writes.length>0,'An existing drift history must not turn a 1.597s source offset into an indefinitely slow catch-up');
  assert.ok(result.writes.every(time=>time>=1.5&&time<1.6),'The active source is repositioned within its current clip, before its 3.2s end');
  for(const rate of [.25,1,4]){
    assert.deepEqual(repeatedAudioSync(patched,rate,.06*rate,false,{primed:true}).writes,[],'60ms of timeline drift is corrected gently at each playback rate');
    assert.ok(repeatedAudioSync(patched,rate,.15*rate,false,{primed:true}).writes.length>0,'A stable 150ms timeline offset must hard-align, including slow and accelerated audio');
  }
});

test('inaudible native audio pauses and skips decoder timing while positive automation resumes exactly',()=>{
  const silent=repeatedAudioSync(patched,1,.15,false,{volume:0});
  assert.deepEqual(silent.writes,[],'Effective zero gain must not repeatedly seek an inaudible decoder');
  assert.deepEqual(silent.rates,[],'Effective zero gain must not adjust native rate');
  assert.deepEqual(silent.actions,[{action:'pause',frame:0}],'An already-playing silent native audio is paused once');
  const stopped=repeatedAudioSync(patched,1,.15,false,{volume:0,paused:true});
  assert.deepEqual(stopped.actions,[],'A paused silent source must not be started');
  for(const options of [{volumes:[0,0,0,1]},{volume:0,automation:frame=>frame<3?0:.5}]){
    const resumed=repeatedAudioSync(patched,1,.06,false,options);
    assert.deepEqual(resumed.actions,[{action:'pause',frame:0},{action:'seek',frame:3},{action:'play',frame:3}],'Unmuting or positive keyframe gain aligns the source before resuming');
  }
  const fade=repeatedAudioSync(patched,1,.06,false,{time:13.9,fades:{fadeIn:1,fadeOut:0}});
  assert.deepEqual(fade.actions.slice(0,3),[{action:'pause',frame:0},{action:'seek',frame:1},{action:'play',frame:1}],'A fade beginning at zero resumes as soon as its effective gain becomes positive');
  assert.deepEqual(repeatedAudioSync(patched,1,.15,false,{volume:0,tagName:'VIDEO'}),repeatedAudioSync(upstream,1,.15,false,{volume:0,tagName:'VIDEO'}),'Silent video still presents picture normally');
});

test('secondary audio retains exact paused, preroll, forced and discontinuous seeks',()=>{
  assert.ok(repeatedAudioSync(patched,1,.06,true).writes.length>0,'Forced native audio sync stays exact');
  assert.ok(repeatedAudioSync(patched,1,.06,false,{playing:false,paused:true}).writes.length>0,'Paused transport seek stays exact');
  assert.ok(repeatedAudioSync(patched,1,.06,false,{time:13.8}).writes.length>0,'Audio cue-ahead keeps its start positioning');
  assert.ok(repeatedAudioSync(patched,1,.6).writes.length>0,'A real discontinuous source jump still hard-seeks');
  for(const force of [false,true])assert.deepEqual(repeatedAudioSync(patched,1,.06,force,{tagName:'VIDEO'}),repeatedAudioSync(upstream,1,.06,force,{tagName:'VIDEO'}),'Playing video behavior is unchanged');
});

test('a blocked active range releases network streams held by inactive decoded clips',()=>{
  const node=(start,end,source,ready)=>Object.assign(new EventTarget(),{tagName:'VIDEO',isConnected:true,paused:true,networkState:2,preload:'auto',readyState:ready,seeking:ready===1,currentTime:source,duration:100,dataset:{start:String(start),end:String(end),duration:String(end-start),mediaStart:String(source)},buffered:{length:0},loads:0,load(){this.loads++;this.networkState=0;},getAttribute:()=>'/same-large-original.mp4'});
  const active=node(17.6,20.7,73.83,1),previous=node(13.8,17.1,69.23,3),next=node(20.7,24.3,77.73,3);
  const doc={querySelectorAll:()=>[active,previous,next],defaultView:{MutationObserver:class{observe(){}disconnect(){}}}};
  const stop=warmPreviewMedia(doc,()=>17.608);
  try{assert.equal(active.loads,0,'The active seek is retained');assert.equal(previous.loads,1,'A paused previous cut cannot retain a stream while the active source waits');assert.equal(next.loads,1,'Even a primed future cut must release its loading stream when the active range is starved');}finally{stop();}
});


test('decoded upcoming video retains the single preparation slot rather than starting more distant source streams',()=>{
  vi.useFakeTimers();
  const node=(kind,start,ready)=>Object.assign(new EventTarget(),{tagName:kind,isConnected:true,paused:true,networkState:1,preload:'none',readyState:ready,seeking:false,currentTime:0,duration:100,dataset:{start:String(start),end:String(start+1),duration:'1',mediaStart:String(start*10)},buffered:{length:1,start:()=>0,end:()=>100},loads:0,load(){this.loads++;},getAttribute:()=>'/source.mp4'});
  const active=node('VIDEO',0,4),soon=[node('VIDEO',1,4),node('AUDIO',1,4),node('VIDEO',2,4),node('AUDIO',2,4)],later=node('VIDEO',3,0);
  const doc={querySelectorAll:()=>[active,...soon,later],defaultView:{MutationObserver:class{observe(){}disconnect(){}}}};
  const stop=warmPreviewMedia(doc,()=>0);
  try{vi.advanceTimersByTime(200);assert.equal(soon[0].preload,'auto');assert.equal(later.preload,'none','A decoded next video can still have an open loading stream; do not create another competitor');}finally{stop();vi.useRealTimers();}
});

test('an active seek into buffered bytes retains already prepared future streams',()=>{
  const node=(start,time,seeking)=>Object.assign(new EventTarget(),{tagName:'VIDEO',isConnected:true,paused:true,networkState:2,preload:'auto',readyState:3,seeking,currentTime:time,duration:100,dataset:{start:String(start),end:String(start+3),duration:'3',mediaStart:String(time)},buffered:{length:1,start:()=>time-1,end:()=>time+2},loads:0,load(){this.loads++;},getAttribute:()=>'/source.mp4'});
  const active=node(0,20,true),future=node(3,50,false);
  const doc={querySelectorAll:()=>[active,future],defaultView:{MutationObserver:class{observe(){}disconnect(){}}}};
  const stop=warmPreviewMedia(doc,()=>0);
  try{assert.equal(future.loads,0,'A transient buffered seek must not discard the next decoded cut');}finally{stop();}
});

test('preview HTML defers inactive native probes before the runtime starts',()=>{
  const timeline={aspectRatio:'16:9',fps:30,clips:[0,3,6].map((start,index)=>({id:`video-${index}`,kind:'video',track:1,start,duration:3,sourceStart:start*10,assetId:'source'}))};
  const assets=[{_id:'source',kind:'video',name:'Source',url:'https://example.com/source.mp4',duration:100,width:1920,height:1080}];
  const preview=generateComposition(timeline,assets,{preview:true});
  assert.match(preview,/data-revline-media-loading="managed"/);
  assert.match(preview,/name="hyperframes-studio-preview"/,'First-frame asset readiness keeps its deferred scope');
  assert.equal((preview.match(/preload="auto"/g)??[]).length,1,'Only first-frame footage can issue a media probe before the bounded scheduler starts');
  assert.equal((preview.match(/preload="none"/g)??[]).length,2);
  const render=generateComposition(timeline,assets);
  assert.equal((render.match(/preload="auto"/g)??[]).length,3,'Export source preparation remains eager');
  assert.doesNotMatch(render,/data-revline-media-loading/);
});

test('actual native visibility helper leaves managed preview preload ownership unchanged',()=>{
  const name='Qy=(c,p,y)=>',start=patched.indexOf(name),end=patched.indexOf(',Zy=',start);
  const run=(managed)=>{
    const node={preload:'none'},changes=[];
    const helper=vm.runInNewContext(`(${patched.slice(start+'Qy='.length,end)})`,{
      document:{documentElement:{dataset:{revlineMediaLoading:managed?'managed':undefined}}},
      d:{isPlaying:()=>false},no:new WeakSet(),pd:new WeakMap(),Tr:new WeakMap(),Jy:()=>{},
      Mo:media=>{changes.push('promote');media.preload='auto';},zf:()=>changes.push('discard'),
    });
    helper(node,false,true);helper(node,false,false);
    return changes;
  };
  assert.deepEqual(run(true),[],'The native helper must neither promote speculative streams nor discard our prepared decoder');
  assert.deepEqual(run(false),['promote','discard'],'Unmanaged runtime compositions preserve upstream behavior');
});

test('a retained outgoing transition frame is never discarded as an inactive stream',()=>{
  const node=Object.assign(new EventTarget(),{tagName:'VIDEO',isConnected:true,paused:true,networkState:2,preload:'auto',readyState:3,seeking:false,currentTime:8,duration:100,dataset:{start:'0',end:'1',duration:'1',mediaStart:'7',revlineTransitionVisible:''},buffered:{length:1,start:()=>7,end:()=>9},loads:0,load(){this.loads++;},getAttribute:()=>'/source.mp4'});
  const doc={querySelectorAll:()=>[node],defaultView:{MutationObserver:class{observe(){}disconnect(){}}}};
  const stop=warmPreviewMedia(doc,()=>1.1);
  try{assert.equal(node.loads,0,'The transition renderer still displays its outgoing retained native frame beyond the authored clip edge');}finally{stop();}
});

test('only active and nearest upcoming video keep loading streams, while idle decoded frames survive',()=>{
  const node=(start,networkState=2)=>Object.assign(new EventTarget(),{tagName:'VIDEO',isConnected:true,paused:true,networkState,preload:'auto',readyState:3,seeking:false,currentTime:0,duration:100,dataset:{start:String(start),end:String(start+1),duration:'1',mediaStart:'0'},buffered:{length:1,start:()=>0,end:()=>100},loads:0,load(){this.loads++;this.networkState=0;},getAttribute:()=>'/large-original.mp4'});
  const active=node(0),nearest=node(1),distant=[node(2),node(3),node(4),node(5),node(6)],past=node(-1),idle=node(-2,1),all=[active,nearest,...distant,past,idle];
  const doc={querySelectorAll:()=>all,defaultView:{MutationObserver:class{observe(){}disconnect(){}}}};
  const stop=warmPreviewMedia(doc,()=>0);
  try{assert.equal(active.loads,0);assert.equal(nearest.loads,0);assert.ok([...distant,past].every(media=>media.loads===1),'All other open video requests are aborted even when they already decoded a first frame');assert.equal(idle.loads,0,'An idle decoded frame has no competing network stream and must survive');assert.equal(idle.preload,'none');}finally{stop();}
});

test('the terminal decoded video frame survives transport end while earlier clips release streams',()=>{
  const node=(start,end)=>Object.assign(new EventTarget(),{tagName:'VIDEO',isConnected:true,paused:true,networkState:2,preload:'auto',readyState:3,seeking:false,currentTime:8,duration:100,dataset:{start:String(start),end:String(end),duration:String(end-start),mediaStart:'7'},buffered:{length:1,start:()=>7,end:()=>9},loads:0,load(){this.loads++;},getAttribute:()=>'/source.mp4'});
  const previous=node(0,1),terminal=node(1,2),doc={getElementById:()=>({dataset:{duration:'2'}}),querySelectorAll:()=>[previous,terminal],defaultView:{MutationObserver:class{observe(){}disconnect(){}}}};
  const stop=warmPreviewMedia(doc,()=>2);
  try{assert.equal(terminal.loads,0,'The runtime deliberately holds its last decoded video at the timeline end');assert.equal(terminal.preload,'auto');assert.equal(previous.loads,1,'A normal earlier clip is still released');}finally{stop();}
});

// A source session shares only the bounded derivative, never the export original.
import {createPreviewSourceCache} from '../lib/editor/preview-source-cache.ts';
import {createPreviewMediaSession} from '../lib/editor/preview-media-session.ts';

const proxyAsset=()=>({_id:'shared-video',kind:'video',fileName:'original.mp4',url:'https://media.test/original?private=original',previewUrl:'https://media.test/preview?private=preview',previewVersion:'v1',previewSize:4,duration:10,width:720,height:1280});
test('all cuts and repeated preparations share one derivative Blob without mutating original assets',async()=>{
  const originalFetch=globalThis.fetch;let calls=0,revoked=[];
  globalThis.fetch=async()=>{calls++;return new Response(new Uint8Array([1,2,3,4]))};
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:shared-preview'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(url=>revoked.push(url));
  const cache=createPreviewSourceCache(),asset=proxyAsset(),original={_id:'uncached-original',kind:'video',fileName:'large.mp4',url:'https://media.test/large'},audio={...asset,_id:'audio-original',kind:'audio'};
  try{
    const [a,b]=await Promise.all([cache.prepare([asset,original,audio],new AbortController().signal),cache.prepare([asset],new AbortController().signal)]);
    assert.equal(calls,1);assert.equal(create.mock.calls.length,1);assert.equal(a[0].url,'blob:shared-preview');assert.equal(b[0].url,a[0].url);assert.equal(a[1],original);assert.equal(a[2],audio);
    assert.equal(asset.url,'https://media.test/original?private=original');
    assert.equal(cache.cachedAssets([{...asset,previewUrl:'https://media.test/preview?private=refreshed'}])[0].url,a[0].url);
    await cache.prepare([asset],new AbortController().signal);assert.equal(calls,1);
  }finally{cache.dispose();globalThis.fetch=originalFetch;create.mockRestore();revoke.mockRestore()}
  assert.deepEqual(revoked,['blob:shared-preview']);
});

test('cancelling one preview preparation keeps a shared download alive for another caller',async()=>{
  const originalFetch=globalThis.fetch;let release,fetchSignal,calls=0;
  globalThis.fetch=(_url,{signal})=>{calls++;fetchSignal=signal;return new Promise(resolve=>{release=()=>resolve(new Response(new Uint8Array([1,2,3,4])))})};
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:shared-cancel'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const cache=createPreviewSourceCache(),first=new AbortController(),second=new AbortController();
  try{
    const a=cache.prepare([proxyAsset()],first.signal),b=cache.prepare([proxyAsset()],second.signal);
    const rejected=assert.rejects(a,error=>error.name==='AbortError');first.abort();await rejected;
    assert.equal(fetchSignal.aborted,false);release();assert.equal((await b)[0].url,'blob:shared-cancel');assert.equal(calls,1);
  }finally{cache.dispose();globalThis.fetch=originalFetch;create.mockRestore();revoke.mockRestore()}
});

test('an abandoned derivative fetch is aborted and a replacement preparation starts cleanly',async()=>{
  const originalFetch=globalThis.fetch;let calls=0,firstSignal;
  globalThis.fetch=(_url,{signal})=>{calls++;if(calls>1)return Promise.resolve(new Response(new Uint8Array([1,2,3,4])));firstSignal=signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}))};
  const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:replacement'),revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const cache=createPreviewSourceCache(),first=new AbortController();
  try{
    const pending=cache.prepare([proxyAsset()],first.signal),rejected=assert.rejects(pending,error=>error.name==='AbortError');first.abort();await rejected;
    assert.equal(firstSignal.aborted,true);
    assert.equal((await cache.prepare([proxyAsset()],new AbortController().signal))[0].url,'blob:replacement');assert.equal(calls,2);
  }finally{cache.dispose();globalThis.fetch=originalFetch;create.mockRestore();revoke.mockRestore()}
});

test('large derivatives stay on native ranges and dishonest oversized response bodies never become Blobs',async()=>{
  const originalFetch=globalThis.fetch;let calls=0,cancelled=false;
  globalThis.fetch=async()=>{calls++;return {ok:true,status:200,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(64*1024*1024+1)}),cancel:async()=>{cancelled=true},releaseLock(){}})}}};
  const create=vi.spyOn(URL,'createObjectURL'),cache=createPreviewSourceCache(),signal=new AbortController().signal;
  try{
    const large={...proxyAsset(),previewSize:64*1024*1024+1};assert.equal((await cache.prepare([large],signal))[0].url,large.previewUrl);assert.equal(calls,0);
    const small=proxyAsset();assert.equal((await cache.prepare([small],signal))[0].url,small.previewUrl);assert.equal(calls,1);assert.equal(cancelled,true);assert.equal(create.mock.calls.length,0);
  }finally{cache.dispose();globalThis.fetch=originalFetch;create.mockRestore()}
});

function sessionDocument(media=[]){
  const doc=new EventTarget(),win=new EventTarget();let disconnected=0;
  win.MutationObserver=class{observe(){}disconnect(){disconnected++}};
  Object.assign(doc,{defaultView:win,documentElement:{dataset:{}},querySelectorAll:()=>media,getElementById:()=>({dataset:{duration:'10'}})});
  const transport=new EventTarget();let clock=0,plays=0;
  Object.assign(transport,{paused:true,play(){plays++;transport.paused=false;transport.dispatchEvent(new Event('play'))},pause(){transport.paused=true;transport.dispatchEvent(new Event('pause'))},seek(time){clock=time;transport.paused=true}});
  return {doc,transport,readTime:()=>clock,disconnected:()=>disconnected,plays:()=>plays};
}
test('a preview media session owns transport intent, readiness cancellation and complete cleanup',async()=>{
  vi.useFakeTimers();const fixture=sessionDocument(),errors=[];const session=createPreviewMediaSession({...fixture,document:fixture.doc,timeline:{clips:[],fps:30,aspectRatio:'vertical'},assets:[],onError:message=>errors.push(message),onWaiting:()=>{}});
  try{
    session.play();assert.equal(session.isPlaying(),true);session.resync(()=>fixture.transport.seek(3));assert.equal(session.isPlaying(),true);assert.equal(fixture.readTime(),3);
    session.seek(4);assert.equal(session.isPlaying(),false);
    const aborted=new AbortController();aborted.abort();await assert.rejects(session.whenReady(4,aborted.signal),error=>error.name==='AbortError');
    await session.whenReady(4,new AbortController().signal);session.dispose();session.dispose();assert.equal(fixture.disconnected(),1);
    const count=fixture.plays();session.play();await vi.advanceTimersByTimeAsync(9000);assert.equal(fixture.plays(),count);assert.deepEqual(errors,[]);
  }finally{session.dispose();vi.useRealTimers()}
});

test('quiet stalled-source refresh failures never report unavailable footage or expose signed URLs',async()=>{
  vi.useFakeTimers();const media=new EventTarget();Object.assign(media,{tagName:'VIDEO',isConnected:true,paused:true,preload:'auto',networkState:2,readyState:1,currentTime:0,duration:10,seeking:false,error:null,dataset:{start:'0',end:'10',duration:'10',sourceClip:'clip',mediaStart:'0'},buffered:{length:0},hasAttribute:()=>true});
  const fixture=sessionDocument([media]),errors=[],refresh=vi.fn(async()=>{throw new Error('https://private.test/read?token=secret')});const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  const session=createPreviewMediaSession({...fixture,document:fixture.doc,timeline:{clips:[{id:'clip',kind:'video',assetId:'shared-video',start:0,duration:10,sourceStart:0}],fps:30,aspectRatio:'vertical'},assets:[proxyAsset()],refreshMedia:refresh,onError:message=>errors.push(message),onWaiting:()=>{}});
  try{
    await vi.advanceTimersByTimeAsync(9000);assert.equal(refresh.mock.calls.length,1);assert.deepEqual(errors,[]);assert.ok(!JSON.stringify(warn.mock.calls).includes('token=secret'));
    const event=new Event('error');Object.defineProperty(event,'target',{value:media});fixture.doc.dispatchEvent(event);await vi.advanceTimersByTimeAsync(0);
    assert.equal(errors.length,1);assert.ok(!errors[0].includes('https:'));assert.match(errors[0],/source is unavailable/);
  }finally{session.dispose();warn.mockRestore();vi.useRealTimers()}
});

test('recovered media blocked by autoplay preserves a clear press-play prompt',async()=>{
  vi.useFakeTimers();const media=new EventTarget();Object.assign(media,{tagName:'VIDEO',isConnected:true,paused:true,preload:'auto',networkState:1,readyState:3,currentTime:0,duration:10,seeking:false,error:null,volume:1,muted:false,playbackRate:1,dataset:{start:'0',end:'10',duration:'10',sourceClip:'clip',mediaStart:'0'},buffered:{length:1,start:()=>0,end:()=>10},hasAttribute:()=>true,load(){queueMicrotask(()=>media.dispatchEvent(new Event('loadedmetadata')))},play:async()=>{throw new DOMException('gesture required','NotAllowedError')},pause(){media.paused=true}});
  const fixture=sessionDocument([media]),errors=[];fixture.transport.paused=false;
  const session=createPreviewMediaSession({...fixture,document:fixture.doc,timeline:{clips:[{id:'clip',kind:'video',assetId:'shared-video',start:0,duration:10,sourceStart:0}],fps:30,aspectRatio:'vertical'},assets:[{...proxyAsset(),url:'blob:local-preview'}],onError:message=>errors.push(message),onWaiting:()=>{}});
  try{
    const event=new Event('error');Object.defineProperty(event,'target',{value:media});fixture.doc.dispatchEvent(event);await vi.advanceTimersByTimeAsync(0);
    assert.deepEqual(errors,['The media has recovered. Press play to resume.']);assert.equal(fixture.transport.paused,true);
  }finally{session.dispose();vi.useRealTimers()}
});

test('truncated successful responses are not cached and pending reservations bound total preview memory',async()=>{
  const originalFetch=globalThis.fetch;let releases=[],calls=0;
  const create=vi.spyOn(URL,'createObjectURL'),cache=createPreviewSourceCache(),signal=new AbortController().signal;
  try{
    globalThis.fetch=async()=>new Response(new Uint8Array([1,2]));
    const small=proxyAsset();assert.equal((await cache.prepare([small],signal))[0].url,small.previewUrl);assert.equal(create.mock.calls.length,0);
    globalThis.fetch=async()=>{calls++;await new Promise(resolve=>releases.push(resolve));return new Response(new Uint8Array([1]))};
    const big=[0,1,2].map(index=>({...proxyAsset(),_id:'bounded-'+index,previewSize:64*1024*1024}));
    const pending=cache.prepare(big,signal);assert.equal(calls,2,'Pending full-size derivatives reserve the shared128MiB budget');releases.forEach(release=>release());
    const prepared=await pending;assert.ok(prepared.every(asset=>asset.url===asset.previewUrl));assert.equal(create.mock.calls.length,0);
  }finally{cache.dispose();globalThis.fetch=originalFetch;create.mockRestore()}
});

test('session refresh uses the fresh preferred-preview URL from playback.refresh and retains it through live edits',async()=>{
  vi.useFakeTimers();const media=new EventTarget();let src='https://private.test/stale-preview';
  Object.assign(media,{tagName:'VIDEO',isConnected:true,paused:true,preload:'auto',networkState:1,readyState:3,currentTime:0,duration:10,seeking:false,error:null,volume:1,muted:false,playbackRate:1,dataset:{start:'0',end:'10',duration:'10',sourceClip:'clip',mediaStart:'0'},buffered:{length:1,start:()=>0,end:()=>10},hasAttribute:()=>true,getAttribute:name=>name==='src'?src:null,load(){queueMicrotask(()=>media.dispatchEvent(new Event('loadedmetadata')))},pause(){media.paused=true}});
  Object.defineProperty(media,'src',{get:()=>src,set:value=>{src=value}});
  const fixture=sessionDocument([media]),errors=[],asset={...proxyAsset(),url:src,previewUrl:src},timeline={clips:[{id:'clip',kind:'video',assetId:'shared-video',start:0,duration:10,sourceStart:0}],fps:30,aspectRatio:'vertical'};
  const fresh='https://private.test/fresh-preview';
  const session=createPreviewMediaSession({...fixture,document:fixture.doc,timeline,assets:[asset],refreshMedia:async()=>[{_id:asset._id,url:fresh}],onError:message=>errors.push(message),onWaiting:()=>{}});
  try{
    const event=new Event('error');Object.defineProperty(event,'target',{value:media});fixture.doc.dispatchEvent(event);await vi.advanceTimersByTimeAsync(0);
    assert.equal(src,fresh);assert.equal(session.resolveAssets([asset])[0].url,fresh);session.update(timeline,[asset]);assert.equal(session.resolveAssets([asset])[0].url,fresh);assert.deepEqual(errors,[]);
    session.update(timeline,[{...asset,url:'https://private.test/new-generation'}]);assert.equal(session.resolveAssets([{...asset,url:'https://private.test/new-generation'}])[0].url,'https://private.test/new-generation');
  }finally{session.dispose();vi.useRealTimers()}
});

test('a stalled derivative read falls back after byte-idle timeout even when stream cancellation also hangs',async()=>{
  vi.useFakeTimers();const originalFetch=globalThis.fetch;let fetchSignal,cancelled=0;
  globalThis.fetch=async(_url,{signal})=>{fetchSignal=signal;return {ok:true,status:200,headers:new Headers(),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>{cancelled++;return new Promise(()=>{})},releaseLock(){}})}}};
  const cache=createPreviewSourceCache(),asset=proxyAsset();
  try{
    let settled=false;const pending=cache.prepare([asset],new AbortController().signal).then(assets=>{settled=true;return assets});
    await vi.advanceTimersByTimeAsync(29_999);assert.equal(settled,false);
    await vi.advanceTimersByTimeAsync(1002);const prepared=await pending;
    assert.equal(prepared[0].url,asset.previewUrl);assert.equal(fetchSignal.aborted,true);assert.equal(cancelled,1);
  }finally{cache.dispose();globalThis.fetch=originalFetch;vi.useRealTimers()}
});

test('a delayed refresh never replaces a reused clip node after a live edit changes its asset',async()=>{
  vi.useFakeTimers();const media=new EventTarget();let src='https://private.test/source-a',release;
  Object.assign(media,{tagName:'VIDEO',isConnected:true,paused:true,preload:'auto',networkState:1,readyState:3,currentTime:0,duration:10,seeking:false,error:null,volume:1,muted:false,playbackRate:1,dataset:{start:'0',end:'10',duration:'10',sourceClip:'clip',mediaStart:'0'},buffered:{length:1,start:()=>0,end:()=>10},hasAttribute:()=>true,getAttribute:name=>name==='src'?src:null,load:vi.fn(),pause(){}});Object.defineProperty(media,'src',{get:()=>src,set:value=>{src=value}});
  const fixture=sessionDocument([media]),errors=[],asset={...proxyAsset(),url:src,previewUrl:src},timeline={clips:[{id:'clip',kind:'video',assetId:asset._id,start:0,duration:10,sourceStart:0}],fps:30,aspectRatio:'vertical'};
  const session=createPreviewMediaSession({...fixture,document:fixture.doc,timeline,assets:[asset],refreshMedia:()=>new Promise(resolve=>{release=resolve}),onError:message=>errors.push(message),onWaiting:()=>{}});
  try{
    const event=new Event('error');Object.defineProperty(event,'target',{value:media});fixture.doc.dispatchEvent(event);await vi.advanceTimersByTimeAsync(0);
    const replacement={...asset,_id:'asset-b',url:'https://private.test/source-b',previewUrl:'https://private.test/source-b'};src=replacement.url;
    session.update({...timeline,clips:timeline.clips.map(clip=>({...clip,assetId:replacement._id}))},[asset,replacement]);release([{_id:asset._id,url:'https://private.test/fresh-a'}]);await vi.advanceTimersByTimeAsync(0);
    assert.equal(src,replacement.url);assert.equal(media.load.mock.calls.length,0);assert.deepEqual(errors,[]);
  }finally{session.dispose();vi.useRealTimers()}
});

function thumbnailDocument(){
  const videos=[],draws=[];
  const document={createElement(kind){
    if(kind==='canvas')return {width:0,height:0,getContext:()=>({drawImage:video=>draws.push({src:video.src,time:video.currentTime})}),toDataURL:()=>`data:image/jpeg;sample=${draws.at(-1).src}:${draws.at(-1).time}`};
    assert.equal(kind,'video');
    const video=new EventTarget();Object.assign(video,{src:'',currentTime:0,videoWidth:1920,videoHeight:1080,duration:20,load:vi.fn(),removeAttribute(name){if(name==='src')video.src='';}});videos.push(video);return video;
  }};
  return {document,videos,draws};
}
const thumbnailTick=async()=>{for(let turn=0;turn<6;turn++)await Promise.resolve();};

test('the final thumbnail consumer cancels a pending native metadata read immediately',async()=>{
  const originalDocument=globalThis.document,fixture=thumbnailDocument(),controller=new AbortController(),onFrame=vi.fn();globalThis.document=fixture.document;
  try{
    const pending=videoThumbnails('https://private.test/original',[0],'abort-metadata',onFrame,controller.signal);
    assert.equal(fixture.videos[0].src,'https://private.test/original');controller.abort();
    assert.deepEqual(await pending,[null]);await thumbnailTick();
    assert.equal(fixture.videos[0].src,'');assert.equal(fixture.videos[0].load.mock.calls.length,2);assert.equal(onFrame.mock.calls.length,0);
  }finally{globalThis.document=originalDocument;}
});

test('the final thumbnail consumer also releases a pending native seek',async()=>{
  const originalDocument=globalThis.document,fixture=thumbnailDocument(),controller=new AbortController();globalThis.document=fixture.document;
  try{
    const pending=videoThumbnails('blob:seek-preview',[7.1234567],'abort-seek',undefined,controller.signal),video=fixture.videos[0];
    video.dispatchEvent(new Event('loadeddata'));await thumbnailTick();assert.equal(video.currentTime,7.1234567);
    controller.abort();assert.deepEqual(await pending,[null]);await thumbnailTick();
    assert.equal(video.src,'');assert.equal(fixture.draws.length,0);
  }finally{globalThis.document=originalDocument;}
});

test('aborting one thumbnail caller leaves another consumer on the shared decoder',async()=>{
  const originalDocument=globalThis.document,fixture=thumbnailDocument(),controller=new AbortController();globalThis.document=fixture.document;
  try{
    const cancelled=videoThumbnails('blob:shared-preview',[0],'thumbnail-survivor',undefined,controller.signal);
    const surviving=videoThumbnails('blob:shared-preview',[0],'thumbnail-survivor');
    controller.abort();assert.deepEqual(await cancelled,[null]);assert.equal(fixture.videos.length,1);assert.equal(fixture.videos[0].src,'blob:shared-preview');
    fixture.videos[0].dispatchEvent(new Event('loadeddata'));const [image]=await surviving;
    assert.ok(image.includes('blob:shared-preview'));assert.equal(fixture.draws.length,1);
  }finally{globalThis.document=originalDocument;}
});

test('a new thumbnail source URL owns new pending work while decoded stills remain reusable by asset ID',async()=>{
  const originalDocument=globalThis.document,fixture=thumbnailDocument(),controller=new AbortController();globalThis.document=fixture.document;
  try{
    const old=videoThumbnails('https://private.test/old-original',[2.1234567],'thumbnail-generation',undefined,controller.signal);controller.abort();
    const fresh=videoThumbnails('blob:new-preview',[2.1234567],'thumbnail-generation');
    assert.equal(fixture.videos.length,2);assert.equal(fixture.videos[1].src,'blob:new-preview');
    await old;await thumbnailTick();
    // A third caller joins the new generation even after the old job cleans up.
    const joined=videoThumbnails('blob:new-preview',[2.1234567],'thumbnail-generation');assert.equal(fixture.videos.length,2);
    fixture.videos[1].dispatchEvent(new Event('loadeddata'));await thumbnailTick();fixture.videos[1].dispatchEvent(new Event('seeked'));
    const [image]=await fresh;assert.deepEqual(await joined,[image]);assert.ok(image.includes('blob:new-preview:2.1234567'));
    assert.equal(cachedVideoThumbnail('thumbnail-generation',2.1234567),image);
    assert.deepEqual(await videoThumbnails('blob:later-signed-preview',[2.1234567],'thumbnail-generation'),[image]);assert.equal(fixture.videos.length,2);
  }finally{globalThis.document=originalDocument;}
});

test('a delayed original refresh is not reused after the same asset gains a prepared preview profile',async()=>{
  vi.useFakeTimers();const media=new EventTarget();let src='https://private.test/original',releaseOld;
  Object.assign(media,{tagName:'VIDEO',isConnected:true,paused:true,preload:'auto',networkState:1,readyState:3,currentTime:0,duration:10,seeking:false,error:null,volume:1,muted:false,playbackRate:1,dataset:{start:'0',end:'10',duration:'10',sourceClip:'clip',mediaStart:'0'},buffered:{length:1,start:()=>0,end:()=>10},hasAttribute:()=>true,getAttribute:name=>name==='src'?src:null,load(){queueMicrotask(()=>media.dispatchEvent(new Event('loadedmetadata')))},pause(){}});Object.defineProperty(media,'src',{get:()=>src,set:value=>{src=value}});
  const fixture=sessionDocument([media]),errors=[],asset={_id:'profile-asset',kind:'video',url:src},timeline={clips:[{id:'clip',kind:'video',assetId:asset._id,start:0,duration:10,sourceStart:0}],fps:30,aspectRatio:'vertical'};
  const freshPreview='https://private.test/fresh-preview',refresh=vi.fn(()=>refresh.mock.calls.length===1?new Promise(resolve=>{releaseOld=resolve}):Promise.resolve([{_id:asset._id,url:freshPreview}]));
  const session=createPreviewMediaSession({...fixture,document:fixture.doc,timeline,assets:[asset],refreshMedia:refresh,onError:message=>errors.push(message),onWaiting:()=>{}});
  const error=()=>{const event=new Event('error');Object.defineProperty(event,'target',{value:media});fixture.doc.dispatchEvent(event);};
  try{
    error();await vi.advanceTimersByTimeAsync(0);
    src='https://private.test/preview';session.update(timeline,[{...asset,url:src,previewUrl:src,previewVersion:1,previewSize:100}]);await vi.advanceTimersByTimeAsync(0);
    error();await vi.advanceTimersByTimeAsync(0);releaseOld([{_id:asset._id,url:'https://private.test/fresh-original'}]);await vi.advanceTimersByTimeAsync(0);
    assert.equal(refresh.mock.calls.length,2,'The new source profile must own a separate refresh request');assert.equal(src,freshPreview);assert.deepEqual(errors,[]);
  }finally{session.dispose();vi.useRealTimers()}
});

test('native fallback does not retry the same failed full preview download on every edit',async()=>{
  vi.useFakeTimers();const originalFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('temporary network failure')};const cache=createPreviewSourceCache(),asset=proxyAsset(),signal=new AbortController().signal;
  try{
    assert.equal((await cache.prepare([asset],signal))[0].url,asset.previewUrl);assert.equal((await cache.prepare([asset],signal))[0].url,asset.previewUrl);assert.equal(calls,1);
    const renewed={...asset,previewUrl:'https://media.test/preview?private=renewed'};assert.equal((await cache.prepare([renewed],signal))[0].url,renewed.previewUrl);assert.equal(calls,2,'A renewed signed URL can retry immediately');
    await vi.advanceTimersByTimeAsync(60_001);await cache.prepare([renewed],signal);assert.equal(calls,3,'A later retry is allowed after the failure backoff');
  }finally{cache.dispose();globalThis.fetch=originalFetch;vi.useRealTimers()}
});
