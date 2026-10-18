import {expect,test}from'vitest';
import {configureSmoothZoomPatch,rememberZoomTargets,type ZoomTargetEvidence}from'./zoom-targets';
import {parseFrameInspection}from'../media-analysis/frame-inspection';
import {motionAt}from'../editor/clip-effects';
import type{Clip,MediaAsset}from'../editor/types';
const asset:MediaAsset={_id:'source',kind:'video',fileName:'fixture',url:null,width:1920,height:1080};
const clip:Clip={id:'clip',assetId:'source',kind:'video',start:8,duration:3,sourceStart:10,playbackRate:2,fit:'contain'};
const input={start:8,inDuration:.6,holdDuration:1,outDuration:.6,scale:1.8,easing:'ease-in-out'as const};
function registry(){
 const result=parseFrameInspection(JSON.stringify({summary:'Modal visible',uncertainty:'Sampled instant only',frames:[{frameIndex:300,observation:'Modal upper right'}],events:[],targets:[{frameIndex:300,label:'Modal',confidence:'high',box:{left:.65,top:.15,right:.85,bottom:.35}}]}),{start:10,end:10.1,question:'Locate modal'},[{frameIndex:300,time:10}],30,{sourceWidth:1920,sourceHeight:1080,decodedWidth:960,decodedHeight:540});
 const map=new Map<string,ZoomTargetEvidence>();rememberZoomTargets(result,'source',map,()=> 'target');return map;
}
test('one evidence-backed recipe maps source boxes through retained trims and rate to local timeline motion',()=>{
 const patch=configureSmoothZoomPatch(clip,asset,'landscape',input,{kind:'target',targetId:'target'},registry());
 expect(patch.smoothZoom).toMatchObject({start:0,centerX:.75,centerY:.25,inDuration:.6});
 expect(motionAt(patch.motion!,.6).scale).toBeCloseTo(1.8);expect(motionAt(patch.motion!,2.2).scale).toBeCloseTo(1);
 expect(clip).not.toHaveProperty('motion');
 const shifted=configureSmoothZoomPatch({...clip,start:20},asset,'landscape',{...input,start:20},{kind:'target',targetId:'target'},registry());expect(shifted.motion).toEqual(patch.motion);
});
test('rejects unknown/low-confidence/mismatched/stale target evidence instead of guessing a focus',()=>{
 const focus={kind:'target'as const,targetId:'target'};
 expect(()=>configureSmoothZoomPatch(clip,asset,'landscape',input,focus,new Map())).toThrow('Inspect');
 for(const changes of[{assetId:'other'},{sourceWidth:1280},{time:9},{time:16},{time:14.5},{confidence:'low'as const}]){
  const map=registry();map.set('target',{...map.get('target')!,...changes});expect(()=>configureSmoothZoomPatch(clip,asset,'landscape',input,focus,map)).toThrow();
 }
 expect(()=>configureSmoothZoomPatch(clip,{...asset,width:1280},'landscape',input,focus,registry())).toThrow('geometry');
 expect(()=>configureSmoothZoomPatch({...clip,crop:{left:0,top:0,right:.4,bottom:0}},asset,'landscape',input,focus,registry())).toThrow('visible crop');
});
test('generic centered and user coordinate zooms need no analysis; pixel geometry and timing remain exact',()=>{
 const map=new Map<string,ZoomTargetEvidence>();
 expect(configureSmoothZoomPatch(clip,asset,'landscape',input,{kind:'center'},map).smoothZoom).toMatchObject({centerX:.5,centerY:.5});
 expect(configureSmoothZoomPatch(clip,asset,'landscape',{...input,outDuration:0},{kind:'coordinates',centerX:1440,centerY:270,units:'pixels'},map).smoothZoom).toMatchObject({centerX:.75,centerY:.25});
 for(const patch of[{start:7.9},{start:10.9},{scale:4},{inDuration:0}])expect(()=>configureSmoothZoomPatch(clip,asset,'landscape',{...input,...patch},{kind:'center'},map)).toThrow();
 const custom={...clip,motion:[{time:0,x:0,y:0,scale:1,rotation:10,opacity:1,brightness:1}]};
 expect(()=>configureSmoothZoomPatch(custom,asset,'landscape',input,{kind:'center'},map)).toThrow('custom motion');
 expect(()=>configureSmoothZoomPatch(custom,asset,'landscape',{...input,replaceMotion:true},{kind:'center'},map)).not.toThrow();
});
