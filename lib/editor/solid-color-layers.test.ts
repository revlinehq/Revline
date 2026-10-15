import { expect, test } from 'vitest';
import { addEffectClip, convertSolidColorToVisual, splitClip } from './operations';
import { dropLibraryEffect } from './effect-drag';
import { moveSelectionToNewLayers } from './timeline-controls';
import { DEFAULT_SOLID_COLOR, solidColorPatch } from './clip-effects';
import { generateComposition } from './composition';
import { adjustmentSources } from './adjustment-layers';
import { isPreviewTextOccluded, previewClipAtPoint } from './preview-viewport';
import { deriveTrackCounts, layerGroup, normalizeTimeline, type Clip, type Timeline } from './types';
import { summarizeTimeline } from '../../convex/lib/inspectTimeline';

const base: Timeline = { fps:30, aspectRatio:'landscape', tracks:{visual:1,overlay:0,audio:0,effects:0}, clips:[{id:'footage',kind:'image',assetId:'green',track:1,start:0,duration:5,sourceStart:0,transform:{x:.5,y:.5,scale:.5,rotation:0,opacity:1}}] };
const assets=[{_id:'green',kind:'image' as const,fileName:'Green',width:1920,height:1080,url:'/green.svg'}];

test('new solid colors share V ordering and can be inserted underneath footage',()=>{
  const added=addEffectClip(base,'color','solid-color',0,{duration:5,aboveClipId:'footage'});
  const color=added.clips.find(clip=>clip.id==='color')!;
  expect(color).toMatchObject({kind:'solid',track:2,solidColor:DEFAULT_SOLID_COLOR});
  expect(color.effectPreset).toBeUndefined();expect(layerGroup(color.kind)).toBe('visual');
  expect(deriveTrackCounts(added)).toMatchObject({visual:2,effects:0});
  const behind=moveSelectionToNewLayers(added,['color'],0,'below','color');
  expect(behind.clips.find(clip=>clip.id==='color')?.track).toBe(1);
  expect(behind.clips.find(clip=>clip.id==='footage')?.track).toBe(2);
  expect(previewClipAtPoint(behind,assets,1,{x:960,y:540})?.id).toBe('footage');
  expect(previewClipAtPoint(behind,assets,1,{x:30,y:30})?.id).toBe('color');
});

test('solid library drops use their V row and reject audio/effect rows',()=>{
  const timeline={...base,tracks:{...base.tracks!,visual:3}};
  expect(dropLibraryEffect(timeline,{preset:'solid-color'},1,'visual',3,undefined,'color').clips.at(-1)).toMatchObject({kind:'solid',track:3});
  for(const group of ['audio','effects'] as const)expect(()=>dropLibraryEffect(timeline,{preset:'solid-color'},1,group,1)).toThrow(/visual|V track/i);
});

test('legacy FX solids stay unchanged until explicitly converted',()=>{
  const legacy:Clip={id:'legacy',kind:'effect',effectPreset:'solid-color',track:1,start:1,duration:2,sourceStart:0,solidColor:{...DEFAULT_SOLID_COLOR,color:'#123456',width:.7},motion:[{time:0,x:.1,y:0,scale:1,rotation:10,opacity:.6,brightness:1}],motionOffset:.25};
  const saved={...base,tracks:{...base.tracks!,effects:1},clips:[...base.clips,legacy]};
  expect(normalizeTimeline(saved).clips.at(-1)).toBe(legacy);
  expect(adjustmentSources(saved.clips).map(source=>source.clip.id)).toEqual(['legacy']);
  const next=convertSolidColorToVisual(saved,'legacy'),converted=next.clips.at(-1)!;
  const {effectPreset:_preset,...retained}=legacy;
  expect(converted).toMatchObject({...retained,kind:'solid',track:2});
  expect(converted.effectPreset).toBeUndefined();
  expect(converted.solidColor).toEqual(legacy.solidColor);expect(converted.motion).toEqual(legacy.motion);expect(converted.motionOffset).toBe(.25);
  expect(adjustmentSources(next.clips)).toEqual([]);
  expect(convertSolidColorToVisual(next,'legacy')).toBe(next);
});

test('asset-free color layers render outside FX wrappers and remain editable after splitting',()=>{
  const timeline=addEffectClip(base,'color','solid-color',0,{duration:4});
  const color=timeline.clips.at(-1)!;
  expect(solidColorPatch(color,{color:'#ff0000'}).solidColor?.color).toBe('#ff0000');
  const split=splitClip(timeline,'color',2,'tail');
  expect(split.clips.filter(clip=>clip.kind==='solid').every(clip=>clip.sourceStart===0)).toBe(true);
  const html=generateComposition(timeline,assets);
  expect(html).toContain('data-solid-color-clip="color"');
  expect(html).not.toContain('data-effect-clip="color"');
  expect(()=>generateComposition({...timeline,clips:[color]},[])).not.toThrow();
  expect(summarizeTimeline({...timeline,clips:[color]},[])).toMatchObject({gaps:[],missingAssetRefs:[]});
});

test('transparent color motion leaves underlying text selectable',()=>{
  const timeline=addEffectClip({...base,clips:[{id:'text',kind:'graphic',text:'Visible',track:1,start:0,duration:5,sourceStart:0}]},'color','solid-color',0,{duration:5});
  const faded={...timeline,clips:timeline.clips.map(clip=>clip.kind==='solid'?{...clip,motion:[{time:0,x:0,y:0,scale:1,rotation:0,opacity:0,brightness:1}]}:clip)};
  expect(previewClipAtPoint({...faded,clips:faded.clips.filter(clip=>clip.kind==='solid')},[],1,{x:960,y:540})).toBeUndefined();
  expect(isPreviewTextOccluded(faded,[],1,'text',{left:500,top:400,width:300,height:100})).toBe(false);
});
