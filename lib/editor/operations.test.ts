import { describe,it,expect } from 'vitest';
import { addMediaClip, addTextClip, placeOnFreeLayer, duplicateClip, splitClip } from './operations';
import { alignCutsToBeats } from './beat-cuts';
import { chooseFace } from './tracking';
import { deriveTracks, dimensions, type Timeline } from './types';
const timeline:Timeline={aspectRatio:'vertical',fps:30,clips:[{id:'a',kind:'video',assetId:'source',start:3,duration:4,sourceStart:8}]};
describe('editing source coordinates',()=>{
 it('split preserves exact source offset without dropping frames',()=>{const result=splitClip(timeline,'a',5,'b');expect(result.clips.map(c=>[c.start,c.duration,c.sourceStart])).toEqual([[3,2,8],[5,2,10]]);});
 it('rejects a split outside the selected footage',()=>{expect(()=>splitClip(timeline,'a',8,'b')).toThrow('inside');});
 it('aligns multiple shots to measured audio beats',()=>{const project:Timeline={aspectRatio:'vertical',fps:30,clips:[{id:'music',kind:'audio',assetId:'song',start:0,duration:6,sourceStart:1},{id:'a',kind:'video',assetId:'a',start:0,duration:2.2,sourceStart:2},{id:'b',kind:'video',assetId:'b',start:2.2,duration:3.8,sourceStart:0}]};const result=alignCutsToBeats(project,[{_id:'a',fileName:'a.mp4',kind:'video',duration:10,url:null},{_id:'b',fileName:'b.mp4',kind:'video',duration:10,url:null}],'song',[1,2,3,4,5,6,7]);expect(result.clips.map(c=>[c.start,c.duration,c.sourceStart])).toEqual([[0,6,1],[0,3,2],[3,3,0]]);});
 it('refuses to extend a shot past its source file',()=>{const project:Timeline={aspectRatio:'vertical',fps:30,clips:[{id:'audio',kind:'audio',assetId:'song',start:0,duration:6,sourceStart:0},{id:'a',kind:'video',assetId:'a',start:0,duration:2,sourceStart:0},{id:'b',kind:'video',assetId:'b',start:2,duration:4,sourceStart:0}]};expect(()=>alignCutsToBeats(project,[{_id:'a',kind:'video',fileName:'short.mp4',duration:2,url:null}],'song',[0,1,2,3,4,5,6])).toThrow('too short');});
 it('follows the nearest previous face rather than switching to a larger second face',()=>{expect(chooseFace([{x:.8,y:.5,area:600},{x:.22,y:.55,area:100}],{x:.2,y:.5})?.x).toBe(.22);expect(chooseFace([{x:.8,y:.5,area:600},{x:.22,y:.55,area:100}])?.x).toBe(.8);});
});

describe('real editable layers',()=>{
 it('preserves layer and geometry through split and duplication',()=>{
  const project:Timeline={...timeline,clips:[{...timeline.clips[0],track:3,fit:'contain',crop:{left:.1,top:0,right:0,bottom:0},transform:{x:.5,y:.5,scale:.5,rotation:0,opacity:1}}]};
  const split=splitClip(project,'a',5,'b');expect(split.clips.map(c=>c.track)).toEqual([3,3]);expect(split.clips[1].crop).toEqual(project.clips[0].crop);
  const dupe=duplicateClip(project,'a','copy');expect(dupe.clips[1].track).toBe(3);expect(dupe.clips[1].fit).toBe('contain');
 });
 it('appends footage only after its target visual layer',()=>{
  const project:Timeline={...timeline,clips:[{...timeline.clips[0],start:0,duration:4},{...timeline.clips[0],id:'other',start:0,duration:20,track:2}]};
  const first=addMediaClip(project,{_id:'image',kind:'image'},'new');expect(first.clips.at(-1)?.start).toBe(4);expect(first.clips.at(-1)?.track).toBe(1);
  const second=addMediaClip(project,{_id:'image',kind:'image'},'new',undefined,2);expect(second.clips.at(-1)?.start).toBe(20);
 });
 it('allocates overlap but reuses a layer for adjacent clips',()=>{
  const first=addTextClip({...timeline,clips:[]},'a','graphic',0);
  const overlap=addTextClip(first,'b','caption',0);expect(overlap.clips.at(-1)?.track).toBe(2);
  const third=addTextClip(overlap,'c','caption',0);expect(third.clips.at(-1)?.track).toBe(3);
  const adjacent=placeOnFreeLayer(third,{...third.clips[0],id:'next',start:1});expect(adjacent.clips.at(-1)?.track).toBe(1);
  expect(deriveTracks(third).map(t=>t.label)).toEqual(['V3','V2','V1','A1']);
 });
 it('refuses a twenty-fifth overlapping visual layer',()=>{
  const project:Timeline={...timeline,tracks:{visual:24,overlay:0,audio:1},clips:Array.from({length:24},(_,i)=>({...timeline.clips[0],id:String(i),track:i+1}))};
  expect(()=>placeOnFreeLayer(project,{...timeline.clips[0],id:'extra'})).toThrow('24 layers');
 });
 it('produces even encoder dimensions for five canvas ratios',()=>{
  expect(dimensions('portrait-feed',1080)).toEqual({width:1080,height:1350});expect(dimensions('classic',1080)).toEqual({width:1440,height:1080});
  expect(dimensions('vertical',720)).toEqual({width:720,height:1280});expect(dimensions('square',720)).toEqual({width:720,height:720});expect(dimensions('landscape',720)).toEqual({width:1280,height:720});
 });
});

describe('beat alignment respects stacked footage',()=>{
 it('changes only the primary sequence and leaves a picture-in-picture clip untouched',()=>{
  const picture={id:'pip',kind:'video' as const,track:2,assetId:'pip',start:.7,duration:4,sourceStart:3};
  const project:Timeline={aspectRatio:'vertical',fps:30,clips:[{id:'music',kind:'audio',assetId:'song',start:0,duration:6,sourceStart:0},{id:'a',kind:'video',assetId:'a',start:0,duration:2.2,sourceStart:0},{id:'b',kind:'video',assetId:'b',start:2.2,duration:3.8,sourceStart:0},picture]};
  const aligned=alignCutsToBeats(project,[],'song',[0,1,2,3,4,5,6]);expect(aligned.clips.find(c=>c.id==='pip')).toEqual(picture);expect(aligned.clips.find(c=>c.id==='a')?.duration).toBe(3);
 });
 it('refuses overlapping primary shots instead of moving them into a false sequence',()=>{
  const project:Timeline={...timeline,clips:[{id:'music',kind:'audio',assetId:'song',start:0,duration:8,sourceStart:0},{...timeline.clips[0],start:0},{...timeline.clips[0],id:'b',start:2}]};
  expect(()=>alignCutsToBeats(project,[],'song',[0,1,2,3,4,5,6])).toThrow('overlapping');
 });
});

it('rejects a frame-rounded split whose remaining tail is shorter than one frame', () => {
 const project: Timeline = { ...timeline, clips: [{ ...timeline.clips[0], start: 0, duration: .09999 }] };
 expect(() => splitClip(project, 'a', .06665, 'tail')).toThrow('inside');
 expect(project.clips).toHaveLength(1);
});


describe('shared split frame boundaries', () => {
 for (const fps of [30, 60]) {
  for (const side of ['head', 'tail'] as const) {
   it(`accepts an exact one-frame ${side} at ${fps}fps`, () => {
    const project: Timeline = { ...timeline, fps, clips: [{ ...timeline.clips[0], start: 2, duration: 2 }] };
    const frame = 1 / fps;
    const time = side === 'head' ? 2 + frame : 4 - frame;
    const result = splitClip(project, 'a', time, 'b');
    expect(result.clips[side === 'head' ? 0 : 1].duration).toBe(frame);
    expect(result.clips.every(clip => clip.duration >= frame)).toBe(true);
    expect(result.clips[0].duration + result.clips[1].duration).toBe(2);
    expect(result.clips[1].sourceStart).toBe(project.clips[0].sourceStart + result.clips[0].duration);
    expect(result.clips[1].start).toBe(project.clips[0].start + result.clips[0].duration);
   });
  }
 }
 it('rejects nonfinite, outside and malformed split inputs without changing clips', () => {
  for (const time of [NaN, Infinity, -Infinity, 0, 3, 7, 8]) expect(() => splitClip(timeline, 'a', time, 'b')).toThrow('inside');
  for (const patch of [{ duration: NaN }, { duration: Infinity }, { start: NaN }, { sourceStart: -1 }, { sourceStart: NaN }]) {
   const invalid = { ...timeline, clips: [{ ...timeline.clips[0], ...patch }] };
   expect(() => splitClip(invalid, 'a', 5, 'b')).toThrow('inside');
  }
  expect(timeline.clips).toHaveLength(1);
 });
});
