import { expect, test } from 'vitest';
import { TRANSITION_PRESETS, DEFAULT_TRANSITION_WIPE, centeredTransitionRange, transitionAvailability, transitionDurationLimit, transitionSampleTime, transitionSources, transitionWipeSettings } from './clip-transitions';
import { addEffectClip, addTransitionClip, deleteClip, duplicateClip, patchClip, splitClip } from './operations';
import { moveSelectedClips, moveSelectionToNewLayers, resizeSelectedClips } from './timeline-controls';
import { copyTimelineClips, pasteTimelineClips } from './clipboard';
import { createEditorStore } from './store';
import { applyTimelineEdit } from './timeline-sync';
import { timelineDuration, type Timeline } from './types';
import { dropLibraryEffect } from './effect-drag';

const base: Timeline = { fps:30,aspectRatio:'landscape',tracks:{visual:2,overlay:0,audio:1,effects:0},markers:[{id:'keep',time:6}],clips:[
  {id:'from',kind:'video',assetId:'video',track:1,start:2,duration:3,sourceStart:4,playbackRate:2,volume:0,audioSeparated:true,linkedClipId:'from-audio'},
  {id:'from-audio',kind:'audio',assetId:'sound',track:1,start:2,duration:3,sourceStart:4,playbackRate:2,volume:.7,linkedClipId:'from'},
  {id:'to',kind:'video',assetId:'video',track:1,start:5,duration:2,sourceStart:10,playbackRate:.5,volume:0,audioSeparated:true,linkedClipId:'to-audio'},
  {id:'to-audio',kind:'audio',assetId:'sound',track:1,start:5,duration:2,sourceStart:10,playbackRate:.5,volume:.4,linkedClipId:'to'},
  {id:'caption',kind:'caption',track:2,start:4,duration:2,sourceStart:0,text:'Keep this overlay'},
] };
const fx = (timeline:Timeline) => timeline.clips.find(clip=>clip.id==='fx')!;
const add = () => addTransitionClip(base,'fx','crossfade','from','to');

test.each(['gradient-wipe','iris-wipe'] as const)('%s keeps editable masks through pair edits, clipboard and Undo without changing source/audio clocks',preset=>{
  const settings={softness:.35,wipeDirection:'up' as const,centerX:.2,centerY:.7,shape:'ellipse' as const};
  const options={...settings,preset,aboveClipId:'from',visualTrack:1};
  const next=addTransitionClip(base,'fx',preset,'from','to',options);
  expect(fx(next).transition).toEqual({...settings,fromClipId:'from',toClipId:'to',direction:'clockwise'});
  expect(next.clips.filter(clip=>clip.id!=='fx')).toEqual(base.clips);
  const store=createEditorStore(next);store.getState().edit(patchClip(next,'fx',{transition:{...fx(next).transition!,softness:.1}}));store.getState().undo();expect(fx(store.getState().timeline).transition).toEqual(fx(next).transition);
  const clipboard=copyTimelineClips(next,['from','to','fx']),pasted=pasteTimelineClips(next,clipboard,10).timeline;
  expect(pasted.clips.filter(clip=>clip.kind==='effect'&&clip.id!=='fx')[0].transition).toMatchObject(settings);
  expect(transitionSources(pasted.clips,pasted.fps)).toHaveLength(2);
});

test('wipe defaults preserve legacy transitions and validate every optional control',()=>{
  expect(transitionWipeSettings(fx(add()).transition!)).toEqual(DEFAULT_TRANSITION_WIPE);
  for(const preset of ['gradient-wipe','iris-wipe'] as const){
    const next=addTransitionClip(base,'fx',preset,'from','to');
    expect(transitionWipeSettings(fx(next).transition!)).toEqual(DEFAULT_TRANSITION_WIPE);
    for(const key of ['softness','centerX','centerY'] as const)for(const value of [-.01,1.01,NaN,Infinity])expect(()=>patchClip(next,'fx',{transition:{...fx(next).transition!,[key]:value}})).toThrow(/finite/);
    expect(()=>patchClip(next,'fx',{transition:{...fx(next).transition!,wipeDirection:'diagonal' as never}})).toThrow(/direction/);
    expect(()=>patchClip(next,'fx',{transition:{...fx(next).transition!,shape:'triangle' as never}})).toThrow(/iris/);
    expect(()=>patchClip(next,'fx',{transition:{...fx(next).transition!,softness:0,centerX:0,centerY:1}})).not.toThrow();
  }
});

test('a joined pair keeps its transition when new video and audio rows are needed',()=>{
  const next=add();
  next.clips.push({id:'music',kind:'audio',track:1,start:8,duration:5,sourceStart:0});
  const moved=moveSelectionToNewLayers(next,['from','to'],2,'above','from');
  expect(fx(moved).start).toBeCloseTo(6.7);
  expect(transitionSources(moved.clips,30)[0]).toMatchObject({cut:7,track:3});
  expect(moved.clips.find(clip=>clip.id==='from-audio')).toMatchObject({start:4,track:2,sourceStart:4});
  expect(moved.clips.find(clip=>clip.id==='music')).toEqual(next.clips.at(-1));
});

test.each(TRANSITION_PRESETS)('%s connects the real cut on FX without moving footage, sound or overlays',preset=>{
  const next=addEffectClip(base,'fx',preset,4.8,{aboveClipId:'from',direction:'counter-clockwise'});
  expect(next.clips.slice(0,base.clips.length)).toEqual(base.clips);
  expect(next.markers).toEqual(base.markers);expect(timelineDuration(next)).toBe(timelineDuration(base));
  expect(fx(next)).toMatchObject({kind:'effect',track:1,start:4.7,duration:.6,sourceStart:0,effectPreset:preset,transition:{fromClipId:'from',toClipId:'to',direction:'counter-clockwise'}});
  expect(fx(next).motion).toBeUndefined();
  expect(transitionSources(next.clips,next.fps)[0]).toMatchObject({from:base.clips[0],to:base.clips[2],cut:5,track:1,index:5});
});

test('retained edge holds never decode unretained samples and respect playback speed',()=>{
  expect(transitionSampleTime(base.clips[0],1,30)).toBe(4);
  expect(transitionSampleTime(base.clips[0],4.8,30)).toBeCloseTo(9.6);
  expect(transitionSampleTime(base.clips[0],5.3,30)).toBeCloseTo(4+(3-1/30)*2);
  expect(transitionSampleTime(base.clips[2],4.7,30)).toBe(10);
  expect(transitionSampleTime(base.clips[2],6,30)).toBe(10.5);
  expect(transitionSampleTime(base.clips[2],9,30)).toBeCloseTo(10+(2-1/30)*.5);
});

test('duration is frame-bounded by the real pair and direction changes preserve all media',()=>{
  const next=patchClip(add(),'fx',{duration:10,transition:{...fx(add()).transition!,direction:'counter-clockwise'}});
  expect(fx(next)).toMatchObject({start:3,duration:4,transition:{direction:'counter-clockwise'}});
  expect(next.clips.slice(0,base.clips.length)).toEqual(base.clips);
  expect(()=>centeredTransitionRange(base.clips[0],base.clips[2],30,1/30)).toThrow('two frames');
  expect(()=>addEffectClip({ ...base,clips:base.clips.filter(clip=>clip.id!=='to') },'fx','blur-dissolve',4)).toThrow('neighboring');
});

test('gaps, overlaps, wrong media, cross-layer pairs and overlapping transition ranges are rejected',()=>{
  for(const to of [{...base.clips[2],start:5.1},{...base.clips[2],start:4.9},{...base.clips[2],track:2},{...base.clips[2],kind:'caption' as const}]) {
    expect(()=>addTransitionClip({...base,clips:base.clips.map(clip=>clip.id==='to'?to:clip)},'fx','spin-zoom','from','to')).toThrow();
  }
  expect(()=>addTransitionClip(add(),'second','blur-dissolve','from','to',{track:2})).toThrow('cannot overlap');
  const third={id:'third',kind:'image' as const,assetId:'image',track:1,start:7,duration:3,sourceStart:0};
  const long=addTransitionClip({...base,clips:[...base.clips,third]},'fx','spin-zoom','from','to',{duration:4});
  expect(()=>addTransitionClip(long,'second','blur-dissolve','to','third',{duration:2,track:2})).toThrow('cannot overlap');
  const malformed={...fx(add()),transition:{...fx(add()).transition!,toClipId:'missing'}};
  expect(()=>transitionSources([...base.clips,malformed],30)).toThrow('neighboring');
  expect(()=>transitionSources([...base.clips,{...fx(add()),start:5}],30)).toThrow('span its cut');
});

test('asymmetric transition trims stay across the cut and inside the retained pair',()=>{
  const left=resizeSelectedClips(add(),[],['fx'],'left',.1);
  expect(fx(left).start).toBeCloseTo(4.8);expect(fx(left).duration).toBeCloseTo(.5);
  const shortest=resizeSelectedClips(left,[],['fx'],'left',100);
  expect(fx(shortest).start).toBeCloseTo(5-1/30);
  expect(transitionSources(shortest.clips,30)).toHaveLength(1);
  const wide=resizeSelectedClips(add(),[],['fx'],'right',100);
  expect(fx(wide).start+fx(wide).duration).toBeCloseTo(7);
  expect(wide.clips.slice(0,base.clips.length)).toEqual(base.clips);
});

test('moving a joined pair carries the transition; breaking or deleting its cut removes only that FX',()=>{
  const next=add(),moved=moveSelectedClips(next,['from','to'],2,0);
  expect(fx(moved).start).toBeCloseTo(6.7);expect(fx(moved).transition).toEqual(fx(next).transition);
  expect(moved.clips.find(clip=>clip.id==='from-audio')).toMatchObject({start:4,sourceStart:4,volume:.7});
  const broken=moveSelectedClips(next,['from'],-1,0);
  expect(broken.clips.some(clip=>clip.id==='fx')).toBe(false);
  expect(broken.clips.find(clip=>clip.id==='to')).toEqual(base.clips[2]);
  const deleted=deleteClip(next,'to');expect(deleted.clips.some(clip=>clip.id==='fx'||clip.id==='to-audio')).toBe(false);
  expect(deleted.clips.find(clip=>clip.id==='from')).toEqual(base.clips[0]);
  const store=createEditorStore(next);store.getState().edit(deleted);expect(store.getState().undo()).toEqual(next);expect(store.getState().redo()).toEqual(deleted);
});

test('a moved transition snaps to another real cut on its V layer without moving either pair',()=>{
  const third={id:'third',kind:'image' as const,assetId:'image',track:1,start:7,duration:3,sourceStart:0};
  const next=addTransitionClip({...base,clips:[...base.clips,third]},'fx','blur-dissolve','from','to');
  const moved=moveSelectedClips(next,['fx'],2,0);
  expect(fx(moved)).toMatchObject({start:6.7,transition:{fromClipId:'to',toClipId:'third'}});
  expect(moved.clips.slice(0,-1)).toEqual(next.clips.slice(0,-1));
});

test('availability and creation choose the same nearest free cut beside a selected middle clip',()=>{
  const third={id:'third',kind:'image' as const,assetId:'image',track:1,start:7,duration:3,sourceStart:0};
  const occupied=addTransitionClip({...base,clips:[...base.clips,third]},'fx','crossfade','from','to');
  const availability=transitionAvailability(occupied,5.1,{aboveClipId:'to'});
  expect(availability.available).toBe(true);
  if(availability.available)expect(availability.placement.cut).toBe(7);
  const next=addEffectClip(occupied,'free','spin-zoom',5.1,{aboveClipId:'to'});
  expect(next.clips.find(clip=>clip.id==='free')!.transition).toMatchObject({fromClipId:'to',toClipId:'third'});
  expect(transitionAvailability(next,5.1,{aboveClipId:'to'})).toMatchObject({available:false,reason:expect.stringContaining('cannot overlap')});
});

test('pair blend modes must match; availability skips incompatible cuts and accepts implicit normal',()=>{
  const different={...base,clips:base.clips.map(clip=>clip.id==='from'?{...clip,blendMode:'difference' as const}:clip)};
  expect(transitionAvailability(different,5,{aboveClipId:'to'})).toEqual({available:false,reason:'Transition clips must use the same blend mode.'});
  expect(()=>addTransitionClip(different,'fx','crossfade','from','to')).toThrow('same blend mode');
  expect(()=>transitionSources([...different.clips,fx(add())],30)).toThrow('same blend mode');
  expect(()=>patchClip(add(),'from',{blendMode:'difference'})).toThrow('same blend mode');
  expect(transitionSources(addTransitionClip({...base,clips:base.clips.map(clip=>clip.id==='from'?{...clip,blendMode:'normal'}:clip)},'fx','crossfade','from','to').clips,30)).toHaveLength(1);
  const common={...base,clips:base.clips.map(clip=>clip.id==='from'||clip.id==='to'?{...clip,blendMode:'difference' as const}:clip)};
  expect(transitionSources(addTransitionClip(common,'fx','blur-dissolve','from','to').clips,30)).toHaveLength(1);
  const third={id:'third',kind:'image' as const,assetId:'image',track:1,start:7,duration:3,sourceStart:0};
  const next=addEffectClip({...different,clips:[...different.clips,third]},'fx','spin-zoom',5.1,{aboveClipId:'to'});
  expect(fx(next).transition).toMatchObject({fromClipId:'to',toClipId:'third'});
});

test('transition drops respect the actual V lane/target while FX drops may use a global cut',()=>{
  const isolated={id:'isolated',kind:'image' as const,assetId:'still',track:2,start:10,duration:2,sourceStart:0};
  const timeline={...base,clips:[...base.clips,isolated]};
  expect(()=>dropLibraryEffect(timeline,{preset:'crossfade'},10,'visual',2,'isolated','fx')).toThrow('inside footage');
  expect(()=>dropLibraryEffect(timeline,{preset:'spin-zoom'},10,'visual',2,undefined,'fx')).toThrow('inside footage');
  expect(()=>dropLibraryEffect(timeline,{preset:'blur-dissolve'},5,'audio',1,undefined,'fx')).toThrow('video/image cut');
  expect(fx(dropLibraryEffect(timeline,{preset:'crossfade'},5,'visual',1,'from','fx')).transition).toMatchObject({fromClipId:'from',toClipId:'to'});
  expect(fx(dropLibraryEffect(timeline,{preset:'spin-zoom'},5,'effects',3,undefined,'fx'))).toMatchObject({track:3,transition:{fromClipId:'from',toClipId:'to'}});
});

test('duration controls stop at neighboring bands while staying on their exact cut',()=>{
  const third={id:'third',kind:'image' as const,assetId:'image',track:1,start:7,duration:3,sourceStart:0};
  const first=addTransitionClip({...base,clips:[...base.clips,third]},'fx','crossfade','from','to');
  const next=addTransitionClip(first,'other','spin-zoom','to','third');
  expect(transitionDurationLimit(next,fx(next))).toBeCloseTo(3.4);
  const changed=patchClip(next,'fx',{duration:100});
  expect(fx(changed)).toMatchObject({start:3.3,duration:3.4,transition:{fromClipId:'from',toClipId:'to'}});
  expect(transitionSources(changed.clips,30)).toHaveLength(2);
  expect(changed.clips.find(clip=>clip.id==='other')).toEqual(next.clips.find(clip=>clip.id==='other'));
});

test('source splits keep only the piece touching the original cut, including linked sound',()=>{
  const outgoing=splitClip(add(),'from',4.9,'from-tail');
  expect(fx(outgoing)).toMatchObject({start:4.9,transition:{fromClipId:'from-tail',toClipId:'to'}});
  expect(transitionSources(outgoing.clips,30)).toHaveLength(1);
  expect(outgoing.clips.find(clip=>clip.id==='from-tail-audio')).toMatchObject({start:4.9,linkedClipId:'from-tail'});
  const splitAudio=splitClip(add(),'from-audio',4.9,'audio-tail');
  expect(fx(splitAudio)).toMatchObject({start:4.9,transition:{fromClipId:'audio-tail-audio',toClipId:'to'}});
  expect(transitionSources(splitAudio.clips,30)).toHaveLength(1);
  const incoming=splitClip(add(),'to',5.1,'to-tail');
  expect(fx(incoming).transition?.toClipId).toBe('to');expect(fx(incoming).start+fx(incoming).duration).toBeCloseTo(5.1);
  expect(transitionSources(incoming.clips,30)).toHaveLength(1);
  expect(()=>splitClip(add(),'fx',5,'fx-tail')).toThrow('cannot be split');
  expect(()=>duplicateClip(add(),'fx','copy')).toThrow('both connected clips');
});

test('copying a pair and its transition remaps references without changing originals',()=>{
  const next=add(),copied=copyTimelineClips(next,['from','to','fx']);let id=0;
  const pasted=pasteTimelineClips(next,copied,10,()=>`copy-${++id}`).timeline;
  const sources=transitionSources(pasted.clips,30);expect(sources).toHaveLength(2);
  expect(sources[1].from.id).not.toBe('from');expect(sources[1].to.id).not.toBe('to');expect(sources[1].cut).toBe(13);
  expect(pasted.clips.slice(0,next.clips.length)).toEqual(next.clips);
});

test.each(TRANSITION_PRESETS)('pastes only the copied %s onto another cut, preserving its settings and all footage',preset=>{
  const settings={softness:.34,wipeDirection:'left' as const,centerX:.2,centerY:.7,shape:'ellipse' as const};
  const source=addTransitionClip(base,'fx',preset,'from','to',{duration:.8,direction:'counter-clockwise',...settings});
  const copied=copyTimelineClips(source,['fx']);
  expect(copied.map(clip=>clip.id)).toEqual(['fx']);
  const target:Timeline={...base,clips:[
    {id:'left',kind:'image',assetId:'still',track:1,start:7,duration:3,sourceStart:0},
    {id:'right',kind:'video',assetId:'other',track:1,start:10,duration:3,sourceStart:5},
  ]};
  const result=pasteTimelineClips(target,copied,10,()=>'pasted-fx');
  expect(result.ids).toEqual(['pasted-fx']);
  expect(result.timeline.clips).toHaveLength(target.clips.length+1);
  expect(result.timeline.clips.slice(0,target.clips.length)).toEqual(target.clips);
  expect(transitionSources(result.timeline.clips,30)[0]).toMatchObject({cut:10,clip:{id:'pasted-fx',start:9.6,duration:.8,effectPreset:preset,transition:{fromClipId:'left',toClipId:'right',direction:'counter-clockwise',...settings}}});
  expect(copied).toEqual(copyTimelineClips(source,['fx']));
});

test('pasting a transition inside footage uses the existing split placement and never duplicates its source footage',()=>{
  const source=add(),copied=copyTimelineClips(source,['fx']);
  const result=pasteTimelineClips(base,copied,3,()=>'pasted-fx');
  expect(transitionSources(result.timeline.clips,30)[0]).toMatchObject({cut:3,from:{id:'from',start:2,duration:1},to:{start:3,duration:2,sourceStart:6}});
  expect(result.timeline.clips.filter(clip=>clip.kind==='audio')).toHaveLength(3);
  expect(timelineDuration(result.timeline)).toBe(timelineDuration(base));
  expect(source).toEqual(add());
});

test('pasting just a transition in a gap or on an occupied cut fails without changing footage',()=>{
  const source=add(),snapshot=structuredClone(source),copied=copyTimelineClips(source,['fx']);
  expect(()=>pasteTimelineClips(source,copied,10,()=>'pasted-fx')).toThrow(/inside footage|onto a cut/i);
  expect(()=>pasteTimelineClips(source,copied,5,()=>'pasted-fx')).toThrow(/overlap/i);
  expect(source).toEqual(snapshot);
});

test('pasting onto a specific cut honors its visual lane beneath other footage',()=>{
  const copied=copyTimelineClips(add(),['fx']);
  const target:Timeline={...base,clips:[...base.clips,{id:'upper',kind:'image',track:3,start:0,duration:10,sourceStart:0}]};
  const result=pasteTimelineClips(target,copied,5,()=>'pasted-fx',{visualTrack:1});
  expect(transitionSources(result.timeline.clips,30)[0]).toMatchObject({track:1,from:{id:'from'},to:{id:'to'}});
  expect(result.timeline.clips.filter(clip=>clip.kind!=='effect')).toEqual(target.clips);
});

test('a concurrent source deletion cannot leave dangling transitions in a merged save',()=>{
  const next=add(),current=deleteClip(next,'to'),edited=patchClip(next,'caption',{text:'Updated overlay'});
  const merged=applyTimelineEdit(next,edited,current);
  expect(merged.clips.some(clip=>clip.id==='fx'||clip.id==='to')).toBe(false);
  expect(merged.clips.find(clip=>clip.id==='caption')?.text).toBe('Updated overlay');
});
