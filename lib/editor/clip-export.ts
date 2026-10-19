import { offsetClipMotion } from './clip-effects';
import { isTransitionClip } from './clip-transitions';
import { playbackRateOf } from './playback-rate';
import { normalizeTimeline, type Timeline } from './types';

/** Export the selected footage's visible timeline section without editing the project. */
export function clipExportTimeline(input: Timeline, clipId: string): Timeline {
  const timeline=normalizeTimeline(input),selected=timeline.clips.find(clip=>clip.id===clipId);
  if(!selected||(selected.kind!=='video'&&selected.kind!=='image'))throw new Error('Choose an existing footage clip to export.');
  const start=selected.start,end=start+selected.duration;
  const clips=timeline.clips.flatMap(clip=>{
    const from=Math.max(start,clip.start),to=Math.min(end,clip.start+clip.duration);
    if(to-from<1e-7)return [];
    const offset=from-clip.start;
    return [{...clip,...offsetClipMotion(clip,offset),start:from-start,duration:to-from,sourceStart:clip.kind==='video'||clip.kind==='audio'?clip.sourceStart+offset*playbackRateOf(clip):clip.sourceStart}];
  });
  const ids=new Set(clips.map(clip=>clip.id));
  return {...timeline,clips:clips.filter(clip=>!isTransitionClip(clip)||!!clip.transition&&ids.has(clip.transition.fromClipId)&&ids.has(clip.transition.toClipId)).map(clip=>clip.linkedClipId&&!ids.has(clip.linkedClipId)?{...clip,linkedClipId:undefined}:clip),markers:timeline.markers?.filter(marker=>marker.time>=start&&marker.time<end).map(marker=>({...marker,time:marker.time-start}))};
}
