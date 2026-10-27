import { offsetClipMotion } from './clip-effects';
import { isTransitionClip } from './clip-transitions';
import { playbackRateOf } from './playback-rate';
import { normalizeTimeline, type Timeline } from './types';

/** The timeline between start and end, rebased to 0, without editing the project. */
export function rangeExportTimeline(input: Timeline, start: number, end: number): Timeline {
  const timeline=normalizeTimeline(input);
  const clips=timeline.clips.flatMap(clip=>{
    const from=Math.max(start,clip.start),to=Math.min(end,clip.start+clip.duration);
    if(to-from<1e-7)return [];
    const offset=from-clip.start;
    return [{...clip,...offsetClipMotion(clip,offset),start:from-start,duration:to-from,sourceStart:clip.kind==='video'||clip.kind==='audio'?clip.sourceStart+offset*playbackRateOf(clip):clip.sourceStart}];
  });
  const ids=new Set(clips.map(clip=>clip.id));
  const {sections:_sections,...rest}=timeline;
  return {...rest,clips:clips.filter(clip=>!isTransitionClip(clip)||!!clip.transition&&ids.has(clip.transition.fromClipId)&&ids.has(clip.transition.toClipId)).map(clip=>clip.linkedClipId&&!ids.has(clip.linkedClipId)?{...clip,linkedClipId:undefined}:clip),markers:timeline.markers?.filter(marker=>marker.time>=start&&marker.time<end).map(marker=>({...marker,time:marker.time-start}))};
}

/** Export the selected footage's visible timeline section without editing the project. */
export function clipExportTimeline(input: Timeline, clipId: string): Timeline {
  const selected=input.clips.find(clip=>clip.id===clipId);
  if(!selected||(selected.kind!=='video'&&selected.kind!=='image'))throw new Error('Choose an existing footage clip to export.');
  return rangeExportTimeline(input,selected.start,selected.start+selected.duration);
}

/** Export one named section of the timeline as its own video. */
export function sectionExportTimeline(input: Timeline, sectionId: string): Timeline {
  const section=input.sections?.find(item=>item.id===sectionId);
  if(!section)throw new Error('Choose an existing section to export.');
  return rangeExportTimeline(input,section.start,section.end);
}
