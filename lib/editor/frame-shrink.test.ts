import {expect,test} from 'vitest';
import {configureTimedEffectPatch,DEFAULT_FRAME_SHRINK,frameShrinkKeyframes,motionPreset,validateClipEffects,visibleMotion} from './clip-effects';
import {adjustmentFrame} from './adjustment-layers';
import {addEffectClip,patchClip,splitClip} from './operations';
import {resizeSelectedClips} from './timeline-controls';
import type {Clip,Timeline} from './types';

const base:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:0},clips:[{id:'footage',kind:'video',assetId:'synthetic-video',track:1,start:0,duration:6,sourceStart:2,volume:0,audioSeparated:true,linkedClipId:'audio'},{id:'audio',kind:'audio',assetId:'synthetic-audio',track:1,start:0,duration:6,sourceStart:2,volume:.6,linkedClipId:'footage'}]};
const create=()=>addEffectClip(base,'shrink','frame-shrink',1,{duration:2,aboveClipId:'footage'});

test('frame shrink moves the footage with a smooth center-scale entrance, hold and neutral return',()=>{
  const next=create(),clip=next.clips.at(-1)!;
  expect(next.clips.slice(0,2)).toEqual(base.clips);expect(clip.frameShrink).toEqual(DEFAULT_FRAME_SHRINK);
  expect(adjustmentFrame(clip,.9).scale).toBe(1);expect(adjustmentFrame(clip,1).scale).toBe(1);
  expect(adjustmentFrame(clip,1.05).scale).toBeGreaterThan(1-.24*.125);
  expect(adjustmentFrame(clip,1.4).scale).toBeCloseTo(.76);expect(adjustmentFrame(clip,2.6).scale).toBeCloseTo(.76);
  expect(adjustmentFrame(clip,2.8).scale).toBeCloseTo(.88);expect(adjustmentFrame(clip,3).scale).toBe(1);
  expect(clip.motion!.every(key=>key.x===0&&key.y===0&&key.rotation===0&&key.opacity===1&&key.brightness===1)).toBe(true);
});

test('size/speed partial controls and duration alter only this FX, with hold independent of movement speed',()=>{
  const next=create(),clip=next.clips.at(-1)!;
  const size={...clip,...configureTimedEffectPatch(clip,{frameShrink:{size:.25}})};
  expect(size.frameShrink).toEqual({size:.25,speed:1});expect(adjustmentFrame(size,2).scale).toBe(.5);
  const quick={...size,...configureTimedEffectPatch(size,{frameShrink:{speed:2},duration:4})};
  expect(quick).toMatchObject({start:1,duration:4,frameShrink:{size:.25,speed:2},motionOffset:0});
  expect(adjustmentFrame(quick,1.2).scale).toBe(.5);expect(adjustmentFrame(quick,4.8).scale).toBe(.5);expect(adjustmentFrame(quick,4.9).scale).toBeCloseTo(.75);
  expect(patchClip(next,'shrink',configureTimedEffectPatch(clip,{frameShrink:{size:.25,speed:2}})).clips.slice(0,2)).toEqual(base.clips);
  const resized=resizeSelectedClips(next,[],['shrink'],'right',2).clips.at(-1)!;
  expect(resized.duration).toBe(4);expect(adjustmentFrame(resized,1.2).scale).toBeCloseTo(adjustmentFrame(clip,1.2).scale);expect(adjustmentFrame(resized,4).scale).toBeCloseTo(.76);
});

test('splits retain the original phase while an explicit FX handle trim authors a new bounded pulse',()=>{
  const next=create(),original=next.clips.at(-1)!;
  const split=splitClip(next,'shrink',2.7,'tail');
  for(const clip of split.clips.filter(c=>c.kind==='effect'))for(const offset of [0,clip.duration/2,clip.duration-1e-5])expect(adjustmentFrame(clip,clip.start+offset).scale).toBeCloseTo(adjustmentFrame(original,clip.start+offset).scale,8);
  const trimmed=resizeSelectedClips(next,[],['shrink'],'left',.1).clips.at(-1)!;
  expect(trimmed.motionOffset).toBe(0);expect(visibleMotion(trimmed)[0].scale).toBe(1);expect(trimmed.start).toBeCloseTo(1.1);expect(trimmed.duration).toBeCloseTo(1.9);expect(adjustmentFrame(trimmed,1.5).scale).toBeCloseTo(.76);
});

test('one-frame pulses retain increasing bounded keyframes and exact neutral endpoints at all control limits',()=>{
  for(const duration of [1/60,1/30,2,60])for(const size of [0,.12,.45])for(const speed of [.25,1,4]){
    const clip:Clip={id:'limit',kind:'effect',effectPreset:'frame-shrink',start:0,duration,sourceStart:0,frameShrink:{size,speed},motion:frameShrinkKeyframes(duration,{size,speed})};
    expect(()=>validateClipEffects(clip)).not.toThrow();expect(clip.motion![0].scale).toBe(1);expect(clip.motion!.at(-1)!.scale).toBe(1);
    expect(clip.motion!.every((key,i,keys)=>i===0||key.time>keys[i-1].time)).toBe(true);expect(clip.motion!.length).toBeLessThan(20);
  }
});

test('frame controls reject impossible values/wrong targets and clear when another preset is chosen',()=>{
  const clip=create().clips.at(-1)!;
  for(const frameShrink of [{size:-.01},{size:.46},{size:Infinity},{speed:0},{speed:4.1},{}])expect(()=>configureTimedEffectPatch(clip,{frameShrink})).toThrow();
  expect(()=>configureTimedEffectPatch({...clip,effectPreset:'flash',frameShrink:undefined},{frameShrink:{size:.2}})).toThrow('belong');
  expect(()=>motionPreset(base.clips[0],'frame-shrink')).toThrow('effect clip');
  expect(()=>validateClipEffects({...base.clips[0],frameShrink:{size:.2,speed:1}})).toThrow('belong');
  expect({...clip,...motionPreset(clip,'flash')}.frameShrink).toBeUndefined();
});

test('saved legacy fade FX still validates and renders motion after new fade creation moves to clip settings',()=>{
  const legacy:Clip={id:'legacy',kind:'effect',effectPreset:'fade',start:0,duration:2,sourceStart:0};
  const authored={...legacy,...motionPreset(legacy,'fade')};
  expect(()=>validateClipEffects(authored)).not.toThrow();expect(adjustmentFrame(authored,0).opacity).toBe(0);expect(adjustmentFrame(authored,1).opacity).toBe(1);
  const stretched={...authored,...configureTimedEffectPatch(authored,{duration:3})};expect(stretched.duration).toBe(3);expect(stretched.effectPreset).toBe('fade');
});
