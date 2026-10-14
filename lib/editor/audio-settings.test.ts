import { expect,test } from 'vitest';
import { parseAutomation,sampleAutomationLane } from '@hyperframes/core/audio-automation';
import { fadeGain,clampFadesToDuration,readElementFades } from '@hyperframes/core/audio-fade';
import { audioSettings,audioFadeAttributes,audioVolumeEnvelope,configureAudio,DEFAULT_AUDIO_SETTINGS,validateAudioSettings,validateAudioTimeline } from './audio-settings';
import { splitClip,patchClip,setClipPlaybackRate,duplicateClip } from './operations';
import { resizeSelectedClips } from './timeline-controls';
import { createEditorStore } from './store';
import type { Clip,Timeline } from './types';

const settings=(role:'music'|'voice',patch={})=>({...DEFAULT_AUDIO_SETTINGS,role,ducking:{...DEFAULT_AUDIO_SETTINGS.ducking},...patch});
const music:Clip={id:'music',kind:'audio',assetId:'song',start:2,duration:8,sourceStart:3,track:2,volume:.8,audio:settings('music',{fadeIn:1,fadeOut:2,ducking:{enabled:true,amount:.75,attack:.5,release:1}})};
const voice:Clip={id:'voice',kind:'audio',assetId:'speech',start:4,duration:2,sourceStart:5,track:1,volume:.7,audio:settings('voice')};
const timeline:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:2,effects:0},clips:[{id:'video',kind:'video',assetId:'footage',start:4,duration:2,sourceStart:5,track:1,volume:0,audioSeparated:true,linkedClipId:'voice'},{...voice,linkedClipId:'video'},music]};
const lane=(next=timeline,clip=music)=>parseAutomation(audioVolumeEnvelope(next,clip)).lanes[0];
const nativeGain=(current:Timeline,clip:Clip,time:number)=>{
  const settings=audioFadeAttributes(clip),fades=readElementFades({getAttribute:key=>String(key==='data-fade-in'?settings.fadeIn:settings.fadeOut)});
  return sampleAutomationLane(parseAutomation(audioVolumeEnvelope(current,clip)).lanes[0],time-clip.start)*fadeGain(time-clip.start,clip.duration,fades);
};

test('legacy audio is unchanged and authored fades resolve exactly like native HyperFrames after trims',()=>{
  const legacy={...voice,audio:undefined};expect(audioSettings(legacy)).toEqual(DEFAULT_AUDIO_SETTINGS);
  expect(sampleAutomationLane(lane(timeline,legacy),.2)).toBe(.7);
  const shortened={...music,duration:1};
  expect(audioSettings(shortened)).toMatchObject(clampFadesToDuration({fadeIn:1,fadeOut:2},1));
  expect(music.audio).toMatchObject({fadeIn:1,fadeOut:2});
  expect(fadeGain(.5,1,audioSettings(shortened))).toBeCloseTo(.75);
});

test('music is lowered only under labeled audible voice coverage, with exact clip-local attack/release',()=>{
  const automation=lane();
  for(const [local,gain] of [[1,.8],[1.75,.5],[2,.2],[4,.2],[4.5,.5],[5,.8]])expect(sampleAutomationLane(automation,local)).toBeCloseTo(gain);
  expect(sampleAutomationLane(lane({...timeline,clips:timeline.clips.map(clip=>clip.id==='voice'?{...clip,volume:0}:clip)}),3)).toBe(.8);
  expect(sampleAutomationLane(lane({...timeline,clips:timeline.clips.map(clip=>clip.id==='voice'?{...clip,audio:undefined}:clip)}),3)).toBe(.8);
  expect(sampleAutomationLane(lane(timeline,{...music,audio:settings('music')}),3)).toBe(.8);
  const live=parseAutomation(audioVolumeEnvelope(timeline,music,2)).lanes[0];expect(sampleAutomationLane(live,3)).toBe(.5);
});

test('overlapping and nearby voice spans never double-duck or recover between overlapping ramps',()=>{
  const second={...voice,id:'voice2',start:5,duration:2},near={...voice,id:'voice3',start:7.5,duration:1};
  const automation=lane({...timeline,clips:[...timeline.clips,second,near]});
  for(const local of [3,4.5,5.25,6])expect(sampleAutomationLane(automation,local)).toBeCloseTo(.2);
  expect(sampleAutomationLane(automation,7.5)).toBeCloseTo(.8);
});

test('zero attack/release retains actual step edges instead of smearing gain across the whole music clip',()=>{
  const instantaneous={...music,audio:{...music.audio!,ducking:{enabled:true,amount:1,attack:0,release:0}}};
  const automation=lane(timeline,instantaneous);
  expect(sampleAutomationLane(automation,1.99)).toBe(.8);expect(sampleAutomationLane(automation,2)).toBe(0);
  expect(sampleAutomationLane(automation,4)).toBe(0);expect(sampleAutomationLane(automation,4.01)).toBe(.8);
});

test('audio control targets linked sound and keeps source timing, media, volume and an undo snapshot',()=>{
  const next=configureAudio(timeline,'video',{role:'voice',fadeIn:.4,ducking:{amount:.3}});
  expect(next.clips[0]).toEqual(timeline.clips[0]);expect(next.clips[2]).toEqual(music);
  expect(next.clips[1]).toEqual({...timeline.clips[1],audio:{...voice.audio!,fadeIn:.4,ducking:{...voice.audio!.ducking,amount:.3}}});
  const store=createEditorStore(timeline);store.getState().edit(next);expect(store.getState().undo()).toEqual(timeline);expect(store.getState().redo()).toEqual(next);
  const trimmed=patchClip(next,'voice',{duration:.2});expect(audioSettings(trimmed.clips[1]).fadeIn).toBeCloseTo(.2);
  const split=splitClip(next,'voice',5,'voice-right');expect(split.clips.find(clip=>clip.id==='voice-right')!.audio?.role).toBe('voice');
});

test('splitting authored fades preserves native gain at and around the original cut',()=>{
  const split=splitClip(timeline,'music',5,'music-right');
  for(const time of [2.2,2.8,4.9,5,5.1,8.5,9.8]){
    const child=split.clips.find(clip=>(clip.id==='music'||clip.id==='music-right')&&time>=clip.start&&time<clip.start+clip.duration)!;
    expect(nativeGain(split,child,time)).toBeCloseTo(nativeGain(timeline,music,time),4);
  }
});

test('left/right trims retain fade × duck gain, and only explicit fade edits reset the frozen phase',()=>{
  const left=resizeSelectedClips(timeline,[],['music'],'left',.4),trimmed=resizeSelectedClips(left,[],['music'],'right',-.5);
  const clip=trimmed.clips.find(item=>item.id==='music')!;expect(clip.audioFadeTiming).toMatchObject({duration:8});expect(clip.audioFadeTiming?.offset).toBeCloseTo(.4);
  for(const time of [2.5,2.8,4,4.7,6.3,8.5,9.4])expect(nativeGain(trimmed,clip,time)).toBeCloseTo(nativeGain(timeline,music,time),4);
  const role=configureAudio(trimmed,'music',{role:'original',ducking:{amount:.4}});expect(role.clips.find(item=>item.id==='music')!.audioFadeTiming).toEqual(clip.audioFadeTiming);
  const edited=configureAudio(trimmed,'music',{fadeIn:.5}),fresh=edited.clips.find(item=>item.id==='music')!;expect(fresh.audioFadeTiming).toBeUndefined();
  expect(nativeGain(edited,fresh,fresh.start+.25)).toBeCloseTo(.4);
});

test('split pieces keep source fade phase through duplicate and constant speed changes',()=>{
  const source={...music,audio:{...music.audio!,ducking:{...music.audio!.ducking,enabled:false}}},before={...timeline,clips:timeline.clips.map(clip=>clip.id==='music'?source:clip)};
  const split=splitClip(before,'music',5,'right'),original=split.clips.find(clip=>clip.id==='right')!;
  const duplicated=duplicateClip(split,'right','copy'),copy=duplicated.clips.find(clip=>clip.id==='copy')!;
  for(const local of [.1,2,4.5])expect(nativeGain(duplicated,copy,copy.start+local)).toBeCloseTo(nativeGain(split,original,original.start+local),4);
  const speed=setClipPlaybackRate(split,'right',2),fast=speed.clips.find(clip=>clip.id==='right')!;
  expect(fast.audioFadeTiming).toEqual({duration:4,offset:1.5});expect(fast.audio).toMatchObject({fadeIn:.5,fadeOut:1});
  for(const local of [.1,1,2.25])expect(nativeGain(speed,fast,fast.start+local)).toBeCloseTo(nativeGain(split,original,original.start+local*2),4);
});

test('simultaneous phased fade and duck ramps match the actual native product within a PCM16 sample',()=>{
  const rising={...music,audio:{...music.audio!,fadeIn:4,fadeOut:0}},before={...timeline,clips:timeline.clips.map(clip=>clip.id==='music'?rising:clip)};
  const trimmed=resizeSelectedClips(before,[],['music'],'left',.2),clip=trimmed.clips.find(item=>item.id==='music')!;
  for(let time=3.51;time<4;time+=.017)expect(Math.abs(nativeGain(trimmed,clip,time)-nativeGain(before,rising,time))).toBeLessThan(1/32768);
});

test('invalid audio controls and excessive native automation points fail clearly',()=>{
  expect(()=>configureAudio(timeline,'video',{})).toThrow('Specify');
  expect(()=>configureAudio(timeline,'music',{fadeIn:9})).toThrow('retained clip');
  expect(()=>validateAudioSettings({...music,kind:'video'})).toThrow('audio clips');
  for(const patch of [{fadeIn:-1},{fadeOut:NaN},{role:'dialogue'},{ducking:{enabled:true,amount:2,attack:0,release:0}}])expect(()=>validateAudioSettings({...music,audio:{...music.audio!,...patch} as NonNullable<Clip['audio']>})).toThrow();
  const many=Array.from({length:140},(_,index)=>({...voice,id:`v-${index}`,start:index*10+2,duration:1}));
  expect(()=>validateAudioTimeline({clips:[...many,{...music,start:0,duration:1500}]})).toThrow('Too many separate voice ranges');
});
