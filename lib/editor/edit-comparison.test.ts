import { expect,test } from 'vitest';
import { removedFootageRanges } from './edit-comparison';
import type { Timeline } from './types';
test('a removed source interval stays highlighted in its original position after ripple movement and speed changes',()=>{
  const before:Timeline={fps:30,aspectRatio:'landscape',clips:[{id:'v',kind:'video',assetId:'source',start:2,duration:12,sourceStart:20}]};
  const after:Timeline={...before,clips:[{...before.clips[0],duration:4},{...before.clips[0],id:'tail',start:6,duration:3,sourceStart:26,playbackRate:2}]};
  expect(removedFootageRanges(before,after)).toEqual([{start:6,end:8}]);
  expect(removedFootageRanges(before,before)).toEqual([]);
  expect(removedFootageRanges(before,{...after,clips:[]})).toEqual([{start:2,end:14}]);
});
