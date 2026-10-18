import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'vitest';
import { patchHyperframesPlaybackRuntime, HYPERFRAMES_PLAYBACK_COMPAT_VERSION } from './hyperframes-playback-compat.mjs';

const upstream=readFileSync('node_modules/@hyperframes/core/dist/hyperframe.runtime.iife.js','utf8');
const patched=patchHyperframesPlaybackRuntime(upstream,HYPERFRAMES_PLAYBACK_COMPAT_VERSION);
const alignment=source=>source.slice(source.indexOf('Vd=c=>')+'Vd='.length,source.indexOf(',bs=()=>',source.indexOf('Vd=c=>')));
function run(source,time,rate,current=0){
  const writes=[];const nodes=['VIDEO','AUDIO'].map(tagName=>({tagName,isConnected:true,dataset:{start:'5.366666666666666',duration:'5.5',mediaStart:'59',playbackRate:String(rate)},hasAttribute:name=>name==='data-start',get currentTime(){return current},set currentTime(value){writes.push(value)}}));
  const align=vm.runInNewContext(`(${alignment(source)})`,{document:{querySelectorAll:()=>nodes},pe:()=>true,P:node=>Number(node.dataset.start),Ce:Number,Kt:(time,start,end)=>time>=start&&time<end,vt:node=>Number(node.dataset.mediaStart),$e:node=>Number(node.dataset.playbackRate)});
  align(time);return writes;
}
test('actual upstream helper misplaces middle 4x A/V while the compatibility helper agrees with source mapping',()=>{
  const target=59+(8-5.366666666666666)*4;
  assert.ok(run(upstream,8,4).every(value=>Math.abs(value-target)>7));
  assert.deepEqual(run(patched,8,4),[target,target]);
});
test('one-times speed stays correct and rate-aware alignment does not skip a 60fps frame',()=>{
  const start=5.366666666666666;
  assert.deepEqual(run(patched,8,1),run(upstream,8,1));
  for(const rate of [1,1.5,4]){const writes=run(patched,start+1/60,rate,59);assert.equal(writes.length,2);assert.ok(writes.every(value=>Math.abs(value-(59+rate/60))<1e-10));}
  assert.deepEqual(run(patched,8,4,59+(8-start)*4),[]);
  assert.deepEqual(run(patched,12,4),[]);
});
test('patch is confined to Play/Pause alignment and rejects changed dependencies',()=>{
  const before=alignment(upstream),after=alignment(patched);
  assert.equal(patched.replace(after,before),upstream);
  assert.throws(()=>patchHyperframesPlaybackRuntime(upstream,'0.8.145'),/Review/);
  assert.throws(()=>patchHyperframesPlaybackRuntime(upstream.replace('I=c-S+L','I=changed'),'0.8.144'),/Review/);
});
