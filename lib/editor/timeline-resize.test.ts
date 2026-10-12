import {it,expect} from 'vitest';
import {resizeSelectedClips,shouldCommitClipGesture} from './timeline-controls';
import type {Timeline,MediaAsset} from './types';
const timeline:Timeline={fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:1},clips:[{id:'v1',kind:'video',track:1,assetId:'video',start:0,duration:2,sourceStart:1},{id:'v2',kind:'video',track:1,assetId:'video',start:3,duration:2,sourceStart:2},{id:'a',kind:'audio',track:1,assetId:'audio',start:1,duration:3,sourceStart:2}]};
const assets=[{_id:'video',kind:'video',duration:10},{_id:'audio',kind:'audio',duration:6}] as MediaAsset[];
it('extends only up to the next clip without changing layers',()=>{const next=resizeSelectedClips(timeline,assets,['v1'],'right',5);expect(next.clips[0]).toMatchObject({start:0,duration:3,sourceStart:1,track:1});expect(next.tracks).toEqual(timeline.tracks);});
it('keeps the far edge fixed and respects preceding clips/source bounds',()=>{expect(resizeSelectedClips(timeline,assets,['v2'],'left',-4).clips[1]).toMatchObject({start:2,duration:3,sourceStart:1});});
it('allows audio to be shortened and extended back to its source limits',()=>{const short=resizeSelectedClips(timeline,assets,['a'],'right',-2);expect(short.clips[2].duration).toBe(1);expect(resizeSelectedClips(short,assets,['a'],'right',10).clips[2].duration).toBe(4);});
it('resizes a selection by a shared frame delta limited by its shortest member',()=>{const next=resizeSelectedClips(timeline,assets,['v1','a'],'right',-10);expect(next.clips[0].duration).toBeCloseTo(1/30);expect(next.clips[2].duration-next.clips[0].duration).toBeCloseTo(1);});
it('never changes sourceStart while extending a still image',()=>{const images:Timeline={...timeline,clips:[{id:'image',kind:'image',assetId:'image',start:2,duration:1,sourceStart:0}]};const next=resizeSelectedClips(images,[{_id:'image',kind:'image'}] as MediaAsset[],['image'],'left',-1);expect(next.clips[0]).toMatchObject({start:1,duration:2,sourceStart:0});});

it.each([30,60])('keeps the shortest left/right trim at a strictly valid exact frame at %ifps',fps=>{
  const input:Timeline={...timeline,fps,clips:[{id:'trim',kind:'video',assetId:'video',start:2,duration:2,sourceStart:1}]};
  for(const side of ['left','right'] as const){
    const result=resizeSelectedClips(input,assets,['trim'],side,side==='left'?10:-10).clips[0];
    expect(result.duration).toBeGreaterThanOrEqual(1/fps);
    expect(result.duration).toBe(1/fps);
    if(side==='left')expect(result.start+result.duration).toBeCloseTo(4,12);
    else expect(result.start).toBe(2);
  }
});

it('stops a text or image extension at the project boundary instead of producing a rejected edit',()=>{
  const input:Timeline={fps:30,aspectRatio:'vertical',clips:[
    {id:'last-image',kind:'image',start:298,duration:1,sourceStart:0},
    {id:'last-caption',kind:'caption',start:297,duration:2,sourceStart:0},
  ]};
  const next=resizeSelectedClips(input,[],input.clips.map(clip=>clip.id),'right',20);
  expect(next.clips.map(clip=>clip.start+clip.duration)).toEqual([300,300]);
});

it('commits the clamped left trim when the pointer projects past time zero',()=>{
  const viewport={left:200,top:100,width:600,height:300};
  const input:Timeline={...timeline,clips:[{id:'trim',kind:'image',start:2,duration:3,sourceStart:0}]};
  const pointer={x:180,y:150};
  const preview=resizeSelectedClips(input,[],['trim'],'left',-2.4);
  const committed=shouldCommitClipGesture('left',pointer,viewport)?preview:input;
  expect(committed.clips[0]).toMatchObject({start:0,duration:5,sourceStart:0});
});

it('keeps an outside move drop canceled while allowing clamped right trims',()=>{
  const viewport={left:200,top:100,width:600,height:300};
  expect(shouldCommitClipGesture('move',{x:180,y:150},viewport)).toBe(false);
  expect(shouldCommitClipGesture('move',{x:250,y:150},viewport)).toBe(true);
  expect(shouldCommitClipGesture('right',{x:820,y:150},viewport)).toBe(true);
});

it.each(['video','audio'] as const)('stops a %s left trim at its earliest source frame rather than creating a negative offset',kind=>{
  const input:Timeline={...timeline,clips:[{id:'trim',kind,assetId:kind,start:2.17,duration:1.873,sourceStart:.41}]};
  const atLimit=resizeSelectedClips(input,assets,['trim'],'left',-.42).clips[0];
  const beyond=resizeSelectedClips(input,assets,['trim'],'left',-100).clips[0];
  expect(atLimit).toEqual(beyond);
  expect(atLimit.sourceStart).toBe(0);
  expect(atLimit.start).toBeCloseTo(1.76,12);
  expect(atLimit.start+atLimit.duration).toBeCloseTo(4.043,12);
  expect(atLimit.sourceStart+atLimit.duration).toBeCloseTo(2.283,12);
});

it.each(['video','audio'] as const)('extends a %s to zero only when the source has enough preceding footage',kind=>{
  const input:Timeline={...timeline,clips:[{id:'trim',kind,assetId:kind,start:2.17,duration:1.873,sourceStart:3.4}]};
  const result=resizeSelectedClips(input,assets,['trim'],'left',-100).clips[0];
  expect(result.start).toBe(0);
  expect(result.duration).toBeCloseTo(4.043,12);
  expect(result.sourceStart).toBeCloseTo(1.23,12);
});

it.each([24,30,60])('uses frame deltas during a trim and clamps fractional source bounds at %ifps',fps=>{
  const input:Timeline={...timeline,fps,clips:[{id:'trim',kind:'video',assetId:'video',start:2,duration:1,sourceStart:.01}]};
  const frameTrim=resizeSelectedClips(input,assets,['trim'],'left',1.6/fps).clips[0];
  expect(frameTrim.start).toBeCloseTo(2+2/fps,12);
  expect(frameTrim.sourceStart).toBeCloseTo(.01+2/fps,12);
  const atLimit=resizeSelectedClips(input,assets,['trim'],'left',-1).clips[0];
  expect(atLimit.sourceStart).toBe(0);
  expect(atLimit.start).toBe(1.99);
  expect(atLimit.duration).toBe(1.01);
});
