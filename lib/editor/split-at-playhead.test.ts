import { expect, it } from 'vitest';
import { splitAtPlayhead } from './split-at-playhead';
import type { Timeline } from './types';
const timeline:Timeline={fps:30,aspectRatio:'vertical',clips:[{id:'a',kind:'video',assetId:'v',start:0,duration:10,sourceStart:0,linkedClipId:'sound',audioSeparated:true,volume:0},{id:'sound',kind:'audio',assetId:'s',start:0,duration:10,sourceStart:0,linkedClipId:'a'}]};
it('splits linked media once, then splits the tail even if the old head remains selected',()=>{
  const first=splitAtPlayhead(timeline,['a','sound'],2,()=> 'b');expect(first.clips).toHaveLength(4);
  const second=splitAtPlayhead(first,['a'],4,()=> 'c');expect(second.clips).toHaveLength(6);
  expect(second.clips.filter(c=>c.kind==='video').map(c=>[c.start,c.duration,c.sourceStart])).toEqual([[0,2,0],[2,2,2],[4,6,4]]);
});
it('cuts under the playhead without selection and reports empty positions',()=>{
  expect(splitAtPlayhead(timeline,[],3,()=> 'b').clips).toHaveLength(4);
  expect(()=>splitAtPlayhead(timeline,[],10)).toThrow('inside a clip');
});
it('respects a selected visual without cutting other intersecting layers',()=>{
  const t={...timeline,clips:[...timeline.clips,{id:'text',kind:'graphic' as const,text:'hey',start:0,duration:10,sourceStart:0}]};
  expect(splitAtPlayhead(t,['text'],3,()=> 't2').clips).toHaveLength(4);
});
