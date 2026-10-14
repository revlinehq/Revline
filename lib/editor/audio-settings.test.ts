import { expect,test } from 'vitest';
import { parseAutomation,sampleAutomationLane } from '@hyperframes/core/audio-automation';
import { fadeGain,clampFadesToDuration } from '@hyperframes/core/audio-fade';
import { audioSettings,audioVolumeEnvelope,configureAudio,DEFAULT_AUDIO_SETTINGS,validateAudioSettings,validateAudioTimeline } from './audio-settings';
import { splitClip,patchClip } from './operations';
import { createEditorStore } from './store';
import type { Clip,Timeline } from './types';

const settings=(role:'music'|'voice',patch={})=>({...DEFAULT_AUDIO_SETTINGS,role,ducking:{...DEFAULT_AUDIO_SETTINGS.ducking},...patch});
const music:Clip={id:'music',kind:'audio',assetId:'song',start:2,duration:8,sourceStart:3,track:2,volume:.8,audio:settings('music',{fadeIn:1,fadeOut:2,ducking:{enabled:true,amount:.75,attack:.5,release:1}})};
const voice:Clip={id:'voice',kind:'audio',assetId:'speech',start:4,duration:2,sourceStart:5,track:1,volume:.7,audio:settings('voice')};
const timeline:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:2,effects:0},clips:[{id:'video',kind:'video',assetId:'footage',start:4,duration:2,sourceStart:5,track:1,volume:0,audioSeparated:true,linkedClipId:'voice'},{...voice,linkedClipId:'video'},music]};
const lane=(next=timeline,clip=music)=>parseAutomation(audioVolumeEnvelope(next,clip)).lanes[0];

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

test('invalid audio controls and excessive native automation points fail clearly',()=>{
  expect(()=>configureAudio(timeline,'video',{})).toThrow('Specify');
  expect(()=>configureAudio(timeline,'music',{fadeIn:9})).toThrow('retained clip');
  expect(()=>validateAudioSettings({...music,kind:'video'})).toThrow('audio clips');
  for(const patch of [{fadeIn:-1},{fadeOut:NaN},{role:'dialogue'},{ducking:{enabled:true,amount:2,attack:0,release:0}}])expect(()=>validateAudioSettings({...music,audio:{...music.audio!,...patch} as NonNullable<Clip['audio']>})).toThrow();
  const many=Array.from({length:140},(_,index)=>({...voice,id:`v-${index}`,start:index*10+2,duration:1}));
  expect(()=>validateAudioTimeline({clips:[...many,{...music,start:0,duration:1500}]})).toThrow('Too many separate voice ranges');
});
