import { expect,test } from 'vitest';
import { applyCaptionStyle,patchCaptionStyles,updateCaptionTiming } from './caption-editing';
import { DEFAULT_TEXT_APPEARANCE,resolvedTextAppearance } from './text-style';
import { remotionTextProps } from './remotion-text';
import { textLayerFrame } from './text-layers';
import { motionPreset } from './clip-effects';
import { splitClip } from './operations';
import { createEditorStore } from './store';
import type { Clip,Timeline } from './types';

const source:Clip={id:'one',kind:'caption',track:2,start:1,duration:2,sourceStart:0,text:'Actual saved words',fontFamily:'anton',fontSize:60,color:'#aabbcc',background:'#102030',x:.25,y:.7,blendMode:'difference',transform:{x:.5,y:.5,scale:1,rotation:15,opacity:1},textStyle:{...DEFAULT_TEXT_APPEARANCE,strokeWidth:2,shadowBlur:12},textTemplate:{preset:'word-reveal',duration:2,offset:.3}};
const other:Clip={id:'two',kind:'caption',track:2,start:4,duration:3,sourceStart:0,text:'Different saved words',fontFamily:'geist-mono',color:'#ffffff',animation:'rise'};
const timeline:Timeline={fps:30,aspectRatio:'vertical',tracks:{visual:2,overlay:0,audio:1,effects:0},clips:[{id:'video',kind:'video',assetId:'footage',track:1,start:0,duration:10,sourceStart:2},source,other,{id:'song',kind:'audio',assetId:'music',track:1,start:0,duration:10,sourceStart:0}]};

test('apply appearance to all or exact captions preserves every target words/timing/animation and one undo',()=>{
  const next=applyCaptionStyle(timeline,'one');
  expect(next.clips[0]).toEqual(timeline.clips[0]);expect(next.clips[3]).toEqual(timeline.clips[3]);
  expect(next.clips[2]).toMatchObject({text:other.text,start:4,duration:3,sourceStart:0,animation:'rise',fontFamily:'anton',fontSize:60,color:'#aabbcc',background:'#102030',textStyle:source.textStyle,transform:source.transform});
  expect(next.clips[2].textTemplate).toBeUndefined();expect(next.clips[1].textTemplate).toEqual(source.textTemplate);
  expect(applyCaptionStyle(timeline,'one',['one']).clips[2]).toEqual(other);
  expect(()=>applyCaptionStyle(timeline,'video')).toThrow('caption');expect(()=>applyCaptionStyle(timeline,'one',['song'])).toThrow('caption');
  const store=createEditorStore(timeline);store.getState().edit(next);expect(store.getState().undo()).toEqual(timeline);expect(store.getState().redo()).toEqual(next);
});

test('partial batch styles keep omitted target appearance and do not inherit source words or animation',()=>{
  const next=patchCaptionStyles(timeline,{fontFamily:'dm-serif',rotation:-10,textStyle:{glowBlur:15,glowColor:'#123456'}},['one','two']);
  expect(next.clips[1]).toMatchObject({...source,fontFamily:'dm-serif',transform:{...source.transform!,rotation:-10},textStyle:{...source.textStyle!,glowBlur:15,glowColor:'#123456'}});
  expect(next.clips[2]).toMatchObject({...other,fontFamily:'dm-serif',transform:{rotation:-10},textStyle:{...resolvedTextAppearance(other),glowBlur:15,glowColor:'#123456'}});
  for(const changes of [{fontSize:301},{color:'linear-gradient(red,blue)'},{x:-1},{rotation:361}])expect(()=>patchCaptionStyles(timeline,changes)).toThrow();
});

test('caption range edits snap to project frames and retain exact Remotion phase at an absolute time',()=>{
  const next=updateCaptionTiming(timeline,'one',{start:1.19,end:2.81}),trimmed=next.clips[1];
  expect(trimmed).toMatchObject({start:1.2,text:source.text,sourceStart:0,textTemplate:{preset:'word-reveal',duration:2}});expect(trimmed.duration).toBeCloseTo(1.6);expect(trimmed.textTemplate?.offset).toBeCloseTo(.5);
  expect(remotionTextProps(trimmed,2,30)).toEqual(remotionTextProps(source,2,30));
  expect(next.clips.filter(clip=>clip.id!=='one')).toEqual(timeline.clips.filter(clip=>clip.id!=='one'));
  const extended=updateCaptionTiming(next,'one',{start:.9,end:3});expect(extended.clips[1].textTemplate?.duration).toBe(2);expect(extended.clips[1].textTemplate?.offset).toBeCloseTo(.2);
  for(const range of [{start:2,end:2},{start:-1},{end:Infinity},{end:4.1}])expect(()=>updateCaptionTiming(timeline,'one',range)).toThrow();
});

test.each(['fade','rise','pop'] as const)('%s text keeps the original phase after caption trims and splits',animation=>{
  const clip={...source,textTemplate:undefined,...(animation==='pop'?motionPreset(source,'pop'):{animation})};
  const before={...timeline,clips:timeline.clips.map(item=>item.id==='one'?clip:item)};
  const next=updateCaptionTiming(before,'one',{start:1.2,end:2.8}),trimmed=next.clips[1];
  const input=(value:Clip)=>({clip:value,index:1,fps:30,resolution:1080});
  expect(textLayerFrame(input(trimmed),1.25,1080,1920)).toMatchObject({...textLayerFrame(input(clip),1.25,1080,1920),style:expect.any(Object)});
  const split=splitClip(before,'one',2,'right'),right=split.clips.find(item=>item.id==='right')!;
  expect(textLayerFrame(input(right),2.2,1080,1920)).toMatchObject({...textLayerFrame(input(clip),2.2,1080,1920),style:expect.any(Object)});
});
