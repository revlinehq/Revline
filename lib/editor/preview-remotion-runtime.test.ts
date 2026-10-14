import { expect, it } from 'vitest';
import { loadPreviewRemotion } from './preview-remotion-runtime';
import type { Timeline } from './types';

const empty:Timeline={fps:30,aspectRatio:'landscape',clips:[]};
const text:Timeline={...empty,clips:[{id:'title',kind:'graphic',start:0,duration:1,sourceStart:0,text:'Owned'}]};
function fixture(){
  const scripts:{onload?():void;onerror?():void;src:string;async:boolean;remove():void}[]=[];
  const host:{__revlineRemotionText?:unknown;__revlineRemotionTransitions?:unknown}={};
  const document={defaultView:host,querySelector:()=>({content:'/vendor/remotion-runtime.js'}),createElement:()=>({src:'',async:false,remove(){}}),head:{appendChild:(script:typeof scripts[number])=>scripts.push(script)}} as unknown as Document;
  return {document,host,scripts};
}
it('footage-only scenes do not request optional runtime code',()=>{
  const f=fixture();expect(loadPreviewRemotion(f.document,empty)).toBeNull();expect(f.scripts).toHaveLength(0);
});
it('first text/transition additions share one load on their original iframe and failed loads can retry',async()=>{
  const f=fixture(),first=loadPreviewRemotion(f.document,text)!;
  expect(loadPreviewRemotion(f.document,text)).toBe(first);expect(f.scripts).toHaveLength(1);
  f.scripts[0].onerror!();await expect(first).rejects.toThrow('failed to load');
  const retry=loadPreviewRemotion(f.document,text)!;expect(f.scripts).toHaveLength(2);
  f.host.__revlineRemotionText={};f.host.__revlineRemotionTransitions={};f.scripts[1].onload!();await retry;
  expect(loadPreviewRemotion(f.document,text)).toBeNull();expect(f.scripts).toHaveLength(2);
});
