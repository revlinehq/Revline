import {guardPreviewBuffering} from '../lib/editor/preview-buffering.ts';
import {previewMediaReady,waitForPreviewMedia} from '../lib/editor/preview-readiness.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'vitest';
import { patchHyperframesPlaybackRuntime, HYPERFRAMES_PLAYBACK_COMPAT_VERSION } from './hyperframes-playback-compat.mjs';

const upstream=readFileSync('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js','utf8');
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
test('patch is confined to alignment, audible clock selection and accelerated audio tolerance and rejects changed dependencies',()=>{
  const before=alignment(upstream),after=alignment(patched);
  assert.equal(patched.replace(after,before).replace('!pe(S)||!S.isConnected||h(S)||Number(S.dataset.volume??1)<=0||fl(S)','!pe(S)||!S.isConnected||h(S)||fl(S)').replace('if(!J&&!V&&!G&&X&&ne>Yt*Math.max(1,r.tagName==="AUDIO"&&e.playing?Math.abs(T):1)){','if(!J&&!V&&!G&&X&&ne>Yt){'),upstream);
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
    media.readyState=1;assert.equal(previewMediaReady(media,17.608),false,'Metadata alone never releases the hold');
    media.readyState=3;bufferedEnd=73.94;assert.equal(previewMediaReady(media,17.608),false,'Less than half a second remains a real buffer wait');
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

function repeatedAudioSync(source,rate,drift,forceSync=false){
  const writes=[],maps=Object.fromEntries(['ll','jo','Xr','cl','Jr'].map(key=>[key,new WeakMap()]));
  let current=0;
  const media={tagName:'AUDIO',isConnected:true,paused:false,ended:false,volume:1,playbackRate:rate,preload:'auto',ownerDocument:{},closest:()=>null,
    get currentTime(){return current},set currentTime(value){writes.push(value);current=value}};
  const start=13.9,mediaStart=9.633333333333333;
  const clip={el:media,start,end:16,duration:2.1,mediaStart,rate,sourceDuration:24.789333,volume:1};
  const sync=vm.runInNewContext(`(${source.slice(source.indexOf('function tp('),source.indexOf('var Xt=',source.indexOf('function tp(')))})`,{
    ...maps,al:new WeakSet(),ul:new WeakSet(),er:new WeakSet(),
    Kt:(time,start,end)=>time>=start&&time<end,Bs:value=>value,Wn:(value,time)=>value*time,qr:()=>false,qn:()=>false,
    sl:value=>value,Qe:value=>value,Ff:()=>null,$o:()=>false,jm:{fadeIn:0,fadeOut:0},pl:.5,Yt:.04,fl:()=>false,Qm:()=>{},It:()=>null,H:()=>{},
  });
  for(let frame=0;frame<4;frame++){
    const timeSeconds=14.2+frame/60;current=mediaStart+(timeSeconds-start)*rate-drift;
    sync({clips:[clip],timeSeconds,playing:true,playbackRate:1,forceSync,getCompositionDuration:()=>28});
  }
  return writes;
}

test('accelerated secondary audio does not repeatedly seek for normal timeline drift',()=>{
  assert.ok(repeatedAudioSync(upstream,4,.06).length>0,'Captured 4x audio jitter reproduces in the upstream synchronizer');
  assert.deepEqual(repeatedAudioSync(patched,4,.06),[],'15ms of timeline drift at 4x is normal decoder jitter');
  assert.ok(repeatedAudioSync(patched,4,.24).length>0,'A real 60ms timeline drift is still corrected');
  assert.ok(repeatedAudioSync(patched,1,.06).length>0,'Normal-speed audio keeps its existing sync tolerance');
  assert.ok(repeatedAudioSync(patched,4,.06,true).length>0,'Explicit forced seeks remain exact');
});
