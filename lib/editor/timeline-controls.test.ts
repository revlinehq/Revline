import { normalizeTimeline, type Timeline } from './types';
import { removeEmptyLayers } from './timeline-controls';
import { createEditorStore } from './store';
import { timelineLayout } from './timeline-layout';
import { describe,expect,it } from 'vitest';
import { closestSnap,snapMoveDelta,edgeScrollSpeed,zoomAtAnchor,reorderLayer,deleteEmptyLayer,moveClipToLayer,moveSelectedClips,intersectsSelection,moveSelectionToNewLayers,layerDropTarget,clipLayerDropTarget,resizeSelectedClips } from './timeline-controls';
it('snaps to the nearest edge independent of clip order',()=>{expect(closestSnap(4.1,[4.18,4.08],.2)).toBe(4.08);expect(closestSnap(4,[2,8],.1)).toBe(4);});
it('magnetizes the right edge and other selected clips instead of only the dragged left edge',()=>{
  const clip={id:'caption',kind:'caption' as const,start:.15,duration:2.65,sourceStart:0};
  expect(snapMoveDelta(.25,[clip],[3.15],.13)).toBeCloseTo(.35,12);
  const members=[clip,{...clip,id:'second',start:6,duration:1}];
  expect(snapMoveDelta(.2,members,[7.25],.1)).toBeCloseTo(.25,12);
  expect(snapMoveDelta(.2,members,[12],.1)).toBe(.2);
  expect(snapMoveDelta(.2,members,[.35,7.25],.1)).toBe(.2);
});
it('keeps magnetized imported clip edges together without inserting another row',()=>{
 const timeline: Timeline = {fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:0},clips:[
  {id:'fixed',kind:'video',track:1,start:0,duration:2.01,sourceStart:0},
  {id:'moving',kind:'video',track:1,start:3,duration:1,sourceStart:0},
 ]};
 const next=moveSelectedClips(timeline,['moving'],-.97,0,'below','moving',{marks:[0,2.01],threshold:12/54});
 expect(next.tracks?.visual).toBe(1);
 expect(next.clips.find(c=>c.id==='moving')?.start).toBeCloseTo(2.01,12);
});
it('magnetizes the trailing edge of fractional-duration clips before deciding on a collision',()=>{
 const timeline: Timeline = {fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:0},clips:[
  {id:'moving',kind:'video',track:1,start:0,duration:2.01,sourceStart:0},
  {id:'fixed',kind:'video',track:1,start:4,duration:1,sourceStart:0},
 ]};
 const next=moveSelectedClips(timeline,['moving'],2.02,0,'above','moving',{marks:[4,5],threshold:12/54});
 expect(next.tracks?.visual).toBe(1);
 expect(next.clips[0].start+next.clips[0].duration).toBeCloseTo(4,12);
});
it('keeps a magnetic trim aligned with an imported edge on another row',()=>{
 const timeline: Timeline = {fps:30,aspectRatio:'vertical',tracks:{visual:2,overlay:0,audio:0},clips:[
  {id:'fixed',kind:'video',track:2,start:0,duration:2.01,sourceStart:0},
  {id:'moving',kind:'image',track:1,start:0,duration:1,sourceStart:0},
 ]};
 const next=resizeSelectedClips(timeline,[],['moving'],'right',1.04,{marks:[2.01],threshold:12/54});
 expect(next.clips[1].duration).toBeCloseTo(2.01,12);
});
it('scrolls at timeline edges without running past either limit',()=>{expect(edgeScrollSpeed(15,0,600,100,1000)).toBeLessThan(0);expect(edgeScrollSpeed(599,0,600,0,1000)).toBeGreaterThan(0);expect(edgeScrollSpeed(0,0,600,0,1000)).toBe(0);expect(edgeScrollSpeed(599,0,600,1000,1000)).toBe(0);});
it('keeps the point under the cursor stationary while zooming',()=>{expect(zoomAtAnchor(1,2,100,200)).toBe(400);expect((400+200)/2).toBe((100+200)/1);});
it('reorders whole layers while preserving relative order and other track groups',()=>{
  const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:3,overlay:0,audio:1},clips:[1,2,3].map(track=>({id:`v${track}`,kind:'video' as const,track,start:0,duration:1,sourceStart:0}))};
  expect(reorderLayer(timeline,'visual',1,3).clips.map(c=>c.track)).toEqual([3,1,2]);
  expect(reorderLayer(timeline,'audio',1,1)).toBe(timeline);
});

it('deletes empty rows including the last row without shifting clip times',()=>{
  const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:3,overlay:0,audio:1},clips:[{id:'v',kind:'video' as const,track:3,start:2,duration:1,sourceStart:4}]};
  const next=deleteEmptyLayer(timeline,'visual',2);
  expect(next.tracks?.visual).toBe(2);expect(next.clips[0]).toMatchObject({track:2,start:2,sourceStart:4});
  expect(deleteEmptyLayer(next,'audio',1).tracks?.audio).toBe(0);
  expect(()=>deleteEmptyLayer(next,'visual',2)).toThrow('Remove the clips');
});
it('moves the top layer up into a newly created layer',()=>{
  const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:1,overlay:0,audio:0},clips:[{id:'v',kind:'video' as const,track:1,start:0,duration:1,sourceStart:0}]};
  const next=reorderLayer(timeline,'visual',1,2);expect(next.clips[0].track).toBe(2);expect(next.tracks?.visual).toBe(2);
});
it('uses a free destination and creates room above occupied rows',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:3,overlay:0,audio:1},clips:[{id:'one',kind:'caption' as const,track:1,start:0,duration:1,sourceStart:0},{id:'two',kind:'caption' as const,track:2,start:0,duration:1,sourceStart:0}]};
 expect(moveClipToLayer(timeline,{...timeline.clips[0],track:2}).clips[0].track).toBe(3);
 expect(moveClipToLayer(timeline,{...timeline.clips[0],track:3}).clips[0].track).toBe(3);
});

it('moves a selection together without shifting its sources or relative timing',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:3,overlay:0,audio:1},clips:[{id:'one',kind:'caption' as const,track:1,start:1,duration:1,sourceStart:0},{id:'two',kind:'caption' as const,track:2,start:3,duration:1,sourceStart:2}]};
 const next=moveSelectedClips(timeline,['one','two'],-2,1);
 expect(next.clips.map(c=>c.start)).toEqual([0,2]);expect(next.clips.map(c=>c.track)).toEqual([2,3]);expect(next.clips.map(c=>c.sourceStart)).toEqual([0,2]);
});
it('preserves exact clip times when only the layer changes',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:3,overlay:0,audio:1},clips:[{id:'one',kind:'caption' as const,track:1,start:.15,duration:2.65,sourceStart:0},{id:'two',kind:'caption' as const,track:1,start:3.15,duration:2.65,sourceStart:0}]};
 expect(moveSelectedClips(timeline,['one','two'],0,1).clips.map(c=>c.start)).toEqual([.15,3.15]);
 expect(moveSelectionToNewLayers(timeline,['one','two'],0,'above').clips.map(c=>c.start)).toEqual([.15,3.15]);
 expect(moveSelectionToNewLayers(timeline,['one','two'],0,'below').clips.map(c=>c.start)).toEqual([.15,3.15]);
});
it('only intersects clips within the box, including partial clips',()=>{
 expect(intersectsSelection({left:10,top:10,width:30,height:30},{left:20,top:35,width:50,height:10})).toBe(true);
 expect(intersectsSelection({left:10,top:10,width:30,height:30},{left:20,top:40,width:50,height:10})).toBe(false);
});

it('rejects an overlapping drag without automatically creating another layer',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:1,overlay:0,audio:0},clips:[{id:'one',kind:'video' as const,track:1,start:0,duration:2,sourceStart:1},{id:'two',kind:'video' as const,track:1,start:2,duration:2,sourceStart:4}]};
 expect(()=>moveSelectedClips(timeline,['two'],-2,0)).toThrow('Overlaps a clip');
 expect(timeline.tracks.visual).toBe(1);expect(timeline.clips.map(c=>[c.track,c.start])).toEqual([[1,0],[1,2]]);
});

it('creates top and bottom rows without losing timing, source trims, or existing clips',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:1,overlay:0,audio:0},clips:[{id:'one',kind:'video' as const,track:1,start:0,duration:2,sourceStart:1},{id:'two',kind:'video' as const,track:1,start:2,duration:2,sourceStart:4}]};
 const above=moveSelectionToNewLayers(timeline,['one'],0,'above');expect(above.clips.map(c=>c.track)).toEqual([2,1]);expect(above.tracks?.visual).toBe(2);
 const below=moveSelectionToNewLayers(timeline,['one'],0,'below');expect(below.clips.map(c=>c.track)).toEqual([1,2]);expect(below.clips.map(c=>[c.start,c.duration,c.sourceStart])).toEqual([[0,2,1],[2,2,4]]);
});
it('keeps selected stacked clips together when adding rows below',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:3,overlay:0,audio:0},clips:[1,2,3].map(track=>({id:`v${track}`,kind:'video' as const,track,start:1,duration:2,sourceStart:4}))};
 const next=moveSelectionToNewLayers(timeline,['v2','v3'],1,'below');expect(next.clips.map(c=>c.track)).toEqual([3,1,2]);expect(next.tracks?.visual).toBe(5);expect(next.clips.map(c=>c.start)).toEqual([1,2,2]);
});
it('distinguishes top/bottom creation from moving onto existing rows',()=>{
 const rows=[{top:100,bottom:145,track:2},{top:145,bottom:190,track:1}];
 expect(layerDropTarget(90,rows)).toEqual({edge:'above'});expect(layerDropTarget(200,rows)).toEqual({edge:'below'});expect(layerDropTarget(120,rows)).toEqual({track:2,direction:'above'});
});
it('rejects clips crossing into or beyond the other stack while preserving outer creation zones',()=>{
 const rows=[{top:100,bottom:171,track:1,group:'visual' as const},{top:171,bottom:242,track:1,group:'audio' as const}];
 expect(clipLayerDropTarget(190,rows,'visual')).toBeNull();
 expect(clipLayerDropTarget(270,rows,'visual')).toBeNull();
 expect(clipLayerDropTarget(130,rows,'audio')).toBeNull();
 expect(clipLayerDropTarget(90,rows,'audio')).toBeNull();
 expect(clipLayerDropTarget(80,rows,'visual')).toEqual({edge:'above'});
 expect(clipLayerDropTarget(270,rows,'audio')).toEqual({edge:'below'});
 expect(clipLayerDropTarget(150,rows,'visual')).toEqual({track:1,direction:'below'});
 expect(clipLayerDropTarget(190,rows,'audio')).toEqual({track:1,direction:'above'});
 expect(clipLayerDropTarget(190,rows.slice(0,1),'visual')).toEqual({edge:'below'});
 expect(clipLayerDropTarget(95,rows,'visual')).toEqual({track:1,direction:'above'});
 expect(clipLayerDropTarget(93,rows,'visual')).toEqual({edge:'above'});
 expect(clipLayerDropTarget(245,rows,'audio')).toEqual({track:1,direction:'below'});
 expect(clipLayerDropTarget(249,rows,'audio')).toEqual({edge:'below'});
});
it('creates an audio layer below the audio stack without shifting linked video vertically or changing timing',()=>{
 const timeline:Timeline={fps:30,aspectRatio:'vertical',tracks:{visual:1,overlay:0,audio:1},clips:[
  {id:'video',kind:'video',track:1,start:0,duration:2,sourceStart:1,linkedClipId:'audio',audioSeparated:true,volume:0},
  {id:'audio',kind:'audio',track:1,start:0,duration:2,sourceStart:1,linkedClipId:'video'},
  {id:'other',kind:'audio',track:1,start:3,duration:2,sourceStart:0},
 ]};
 const next=moveSelectionToNewLayers(timeline,['audio'],0,'below','audio');
 expect(next.tracks).toEqual({visual:1,overlay:0,audio:2,effects:0});
 expect(next.clips).toEqual([timeline.clips[0],timeline.clips[1],{...timeline.clips[2],track:2}]);
});
it('keeps the twenty-four visual-layer limit instead of silently losing an extra track',()=>{
 const timeline={fps:30,aspectRatio:'vertical' as const,tracks:{visual:24,overlay:0,audio:0},clips:[{id:'v',kind:'video' as const,track:1,start:0,duration:2,sourceStart:0}]};
 expect(()=>moveSelectionToNewLayers(timeline,['v'],0,'above')).toThrow('24 layers');expect(()=>moveSelectionToNewLayers(timeline,['v'],0,'below')).toThrow('24 layers');
});


describe('remove all empty layers', () => {
 it('compacts empty rows above, between and below without changing timing or stacking order', () => {
  const project: Timeline = { fps: 30, aspectRatio: 'vertical', tracks: { visual: 7, overlay: 4, audio: 3 }, clips: [
   { id: 'top', kind: 'video', assetId: 'a', track: 5, start: 1.2, duration: 3, sourceStart: 2 },
   { id: 'bottom', kind: 'image', assetId: 'b', track: 2, start: 0, duration: 4, sourceStart: 0 },
   { id: 'text', kind: 'caption', track: 3, start: .2, duration: 2, sourceStart: 0, text: 'Caption' },
  ] };
  const next = removeEmptyLayers(project);
  expect(next.tracks).toEqual({ visual: 3, overlay: 0, audio: 0, effects:0 });
  expect(next.clips).toEqual(project.clips.map(clip => ({ ...clip, track: clip.id === 'text' ? 3 : clip.id === 'top' ? 2 : 1 })));
  expect(removeEmptyLayers(next)).toBe(next);
  const store = createEditorStore(project); store.getState().edit(next);
  expect(store.getState().history).toHaveLength(1);
  expect(store.getState().undo()).toEqual(normalizeTimeline(project));
 });
 it('removes every row in a completely empty project', () => {
  expect(removeEmptyLayers({ fps: 30, aspectRatio: 'square', clips: [] }).tracks).toEqual({ visual: 0, overlay: 0, audio: 0, effects:0 });
 });
});

it('moves imported mixed-group selections by one shared delta without changing relative offsets', () => {
 const timeline: Timeline = { fps: 30, aspectRatio: 'vertical', clips: [
  { id: 'caption', kind: 'caption', start: .15, duration: 2, sourceStart: 0 },
  { id: 'video', kind: 'video', start: .01, duration: 3, sourceStart: 4 },
 ] };
 for (const next of [moveSelectedClips(timeline, ['caption', 'video'], .1, 0), moveSelectionToNewLayers(timeline, ['caption', 'video'], .1, 'above')]) {
  expect(next.clips[0].start-next.clips[1].start).toBeCloseTo(.14, 12);
  expect(next.clips.map(clip => clip.sourceStart)).toEqual([0,4]);
 }
});

it('isolates FX collisions, trims, reordering, new rows and empty-row removal from video, text and sound', () => {
 const project:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:3},clips:[
  {id:'video',kind:'video',track:2,start:0,duration:20,sourceStart:10},
  {id:'title',kind:'caption',track:1,start:0,duration:20,sourceStart:0,text:'Keep this'},
  {id:'sound',kind:'audio',track:1,start:0,duration:20,sourceStart:5,volume:.7},
  {id:'flash',kind:'effect',track:1,start:2,duration:1,sourceStart:0,effectPreset:'flash'},
  {id:'bars',kind:'effect',track:3,start:4,duration:2,sourceStart:0,effectPreset:'cinematic-bars'},
 ]};
 const unchanged=project.clips.slice(0,3);
 expect(()=>moveSelectedClips(project,['bars'],-2,-2)).toThrow('Overlaps a clip');
 const moved=moveSelectedClips(project,['flash'],.5,0);
 expect(moved.clips.slice(0,3)).toEqual(unchanged);expect(moved.clips[3].start).toBe(2.5);
 const reordered=reorderLayer(project,'effects',3,1);
 expect(reordered.clips.slice(0,3)).toEqual(unchanged);expect(reordered.clips.slice(3).map(clip=>clip.track)).toEqual([2,1]);
 const removed=deleteEmptyLayer(project,'effects',2);
 expect(removed.tracks?.effects).toBe(2);expect(removed.clips.slice(0,3)).toEqual(unchanged);expect(removed.clips[4].track).toBe(2);
 expect(()=>deleteEmptyLayer(project,'effects',1)).toThrow('Remove the clips');
 expect(removeEmptyLayers(project)).toEqual(removed);
 const newRows=moveSelectionToNewLayers(project,['bars'],0,'below','bars');
 expect(newRows.tracks?.effects).toBe(4);expect(newRows.clips.slice(0,3)).toEqual(unchanged);expect(newRows.clips.slice(3).map(clip=>clip.track)).toEqual([2,1]);
 const trimmed=resizeSelectedClips({...project,clips:[...project.clips,{id:'next',kind:'effect',track:1,start:6,duration:1,sourceStart:0,effectPreset:'flash'}]},[],['flash'],'right',20);
 expect(trimmed.clips[3].duration).toBe(4);expect(trimmed.clips.slice(0,3)).toEqual(unchanged);
 const store=createEditorStore(project);store.getState().edit(newRows);expect(store.getState().undo()).toEqual(project);expect(store.getState().redo()).toEqual(newRows);
});

it('rejects cross-group FX drops and allows only the outer FX creation zone', () => {
 const rows=[{top:52,bottom:86,track:2,group:'effects' as const},{top:86,bottom:120,track:1,group:'effects' as const},{top:120,bottom:178,track:1,group:'visual' as const},{top:178,bottom:236,track:1,group:'audio' as const}];
 expect(clipLayerDropTarget(40,rows,'effects')).toEqual({edge:'above'});
 expect(clipLayerDropTarget(70,rows,'effects')).toEqual({track:2,direction:'below'});
 expect(clipLayerDropTarget(140,rows,'effects')).toBeNull();expect(clipLayerDropTarget(250,rows,'effects')).toBeNull();
 expect(clipLayerDropTarget(70,rows,'visual')).toBeNull();expect(clipLayerDropTarget(70,rows,'audio')).toBeNull();
});

it('creates V rows from the actual gaps between FX/video/audio without shifting FX or linked sound tracks', () => {
 const project:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:1,overlay:0,audio:1,effects:1},clips:[
  {id:'effect',kind:'effect',track:1,start:1,duration:1,sourceStart:0,effectPreset:'flash'},
  {id:'video',kind:'video',track:1,start:2,duration:3,sourceStart:4,audioSeparated:true,linkedClipId:'sound',volume:0},
  {id:'sound',kind:'audio',track:1,start:2,duration:3,sourceStart:4,linkedClipId:'video',volume:.8},
 ]};
 for(const compact of [false,true]) {
  const rows=timelineLayout(project,compact).tracks.map(row=>({...row,track:row.number,bottom:row.top+row.height}));
  const [fx,video,audio]=rows;
  const above=(fx.bottom+video.top)/2,below=(video.bottom+audio.top)/2;
  expect(clipLayerDropTarget(above,rows,'visual')).toEqual({edge:'above'});
  expect(clipLayerDropTarget(below,rows,'visual')).toEqual({edge:'below'});
  expect(clipLayerDropTarget(video.top-3,rows,'visual')).toEqual({track:1,direction:'above'});
  expect(clipLayerDropTarget(video.bottom+3,rows,'visual')).toEqual({track:1,direction:'below'});
  expect(clipLayerDropTarget((fx.top+fx.bottom)/2,rows,'visual')).toBeNull();
  expect(clipLayerDropTarget((audio.top+audio.bottom)/2,rows,'visual')).toBeNull();
  expect(clipLayerDropTarget(fx.top-20,rows,'visual')).toBeNull();expect(clipLayerDropTarget(audio.bottom+20,rows,'visual')).toBeNull();
  for(const edge of ['above','below'] as const) {
   const next=moveSelectionToNewLayers(project,['video'],.5,edge,'video');
   expect(next.tracks).toEqual({visual:2,overlay:0,audio:1,effects:1});expect(next.clips[0]).toEqual(project.clips[0]);
   expect(next.clips[1]).toMatchObject({track:edge==='above'?2:1,start:2.5,duration:3,sourceStart:4,linkedClipId:'sound'});
   expect(next.clips[2]).toEqual({...project.clips[2],start:2.5});
  }
 }
});

it('inserts a new V row between existing V rows while preserving FX, linked audio and normal row drops', () => {
 const project:Timeline={fps:30,aspectRatio:'landscape',tracks:{visual:3,overlay:0,audio:1,effects:1},clips:[
  {id:'effect',kind:'effect',track:1,start:1,duration:1,sourceStart:0,effectPreset:'flash'},
  {id:'video',kind:'video',track:1,start:2,duration:3,sourceStart:4,audioSeparated:true,linkedClipId:'sound',volume:0},
  {id:'sound',kind:'audio',track:1,start:2,duration:3,sourceStart:4,linkedClipId:'video',volume:.8},
  {id:'title',kind:'caption',track:3,start:0,duration:20,sourceStart:0,text:'Keep this'},
  {id:'other',kind:'video',track:2,start:0,duration:10,sourceStart:1},
 ]};
 for(const compact of [false,true]) {
  const rows=timelineLayout(project,compact).tracks.map(row=>({...row,track:row.number,bottom:row.top+row.height}));
  const visual=rows.filter(row=>row.group==='visual');
  expect(clipLayerDropTarget(visual[0].top+visual[0].height/2,rows,'visual')).toEqual({track:3,direction:'below'});
  for(let index=0;index<visual.length-1;index++)for(const offset of [-2,2]) {
   const upper=visual[index],lower=visual[index+1],boundary=(upper.bottom+lower.top)/2;
   const target=clipLayerDropTarget(boundary+offset,rows,'visual');
   expect(target).toEqual(offset<0?{track:upper.track,direction:'below',insert:true}:{track:lower.track,direction:'above',insert:true});
   if(!target||'edge' in target)throw new Error('Expected an internal insertion target');
   const next=moveSelectionToNewLayers(project,['video'],.5,target.direction,'video',undefined,target.track);
   const insertion=upper.track;
   expect(next.tracks).toEqual({visual:4,overlay:0,audio:1,effects:1});expect(next.clips[0]).toEqual(project.clips[0]);
   expect(next.clips[1]).toEqual({...project.clips[1],track:insertion,start:2.5});
   expect(next.clips[2]).toEqual({...project.clips[2],start:2.5});
   expect(next.clips[3]).toEqual({...project.clips[3],track:4});
   expect(next.clips[4]).toEqual({...project.clips[4],track:2>=insertion?3:2});
   const store=createEditorStore(project);store.getState().edit(next);expect(store.getState().undo()).toEqual(project);
  }
 }
 expect(()=>moveSelectionToNewLayers(project,['video'],0,'above','video',undefined,99)).toThrow('existing layer');
});
