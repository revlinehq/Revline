import {expect,test} from 'vitest';
import {cropInputPatch,transformInputPatch} from './visual-inputs';
import {dimensions,type Clip} from './types';
import {calculateVisualRect} from './composition';

const clip:Clip={id:'v',kind:'video',assetId:'video',track:1,start:2,duration:3,sourceStart:4,fit:'contain',transform:{x:.4,y:.6,scale:1.25,rotation:12,opacity:.7},crop:{left:.02,right:.1,top:0,bottom:.1}};
test('canvas pixels normalize centers in landscape and vertical without resetting omitted controls',()=>{
  expect(transformInputPatch(clip,{x:960,y:540},dimensions('landscape'),'pixels')).toEqual({transform:{...clip.transform,x:.5,y:.5}});
  expect(transformInputPatch(clip,{x:540,y:960},dimensions('vertical'),'pixels')).toEqual({transform:{...clip.transform,x:.5,y:.5}});
  expect(transformInputPatch(clip,{x:.2},{})).toEqual({transform:{...clip.transform,x:.2}});
  expect(()=>transformInputPatch(clip,{x:1921},dimensions('landscape'),'pixels')).toThrow('supported range');
  expect(()=>transformInputPatch(clip,{x:10},{width:0,height:1080},'pixels')).toThrow('Known positive');
  expect(()=>transformInputPatch(clip,{x:Infinity},dimensions('landscape'),'pixels')).toThrow('supported range');
});
test('crop pixels use intrinsic axes and preserve source placement, fitted size, transform and retained timing',()=>{
  const patch=cropInputPatch(clip,{left:96,top:54},{width:1920,height:1080},'pixels');
  expect(patch).toEqual({crop:{left:.05,right:.1,top:.05,bottom:.1}});
  const changed={...clip,...patch};
  expect(changed).toMatchObject({start:2,duration:3,sourceStart:4,fit:'contain',transform:clip.transform});
  const before=calculateVisualRect(1920,1080,1920,1080,clip.crop,undefined,'contain');
  const after=calculateVisualRect(1920,1080,1920,1080,changed.crop,undefined,'contain');
  for(const key of ['left','top','width','height'] as const)expect(after[key]).toBe(before[key]);
  expect(cropInputPatch(clip,{left:.05},{})).toEqual({crop:{...clip.crop,left:.05}});
  expect(()=>cropInputPatch(clip,{left:10},{width:1920},'pixels')).toThrow('Known positive');
  expect(()=>cropInputPatch(clip,{left:1824},{width:1920,height:1080},'pixels')).toThrow('more than 5%');
  expect(()=>cropInputPatch(clip,{top:-1},{width:1920,height:1080},'pixels')).toThrow('more than 5%');
});
