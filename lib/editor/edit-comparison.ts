import { playbackRateOf, sourceEndOf } from './playback-rate';
import type { Clip, Timeline } from './types';
export type TimeRange={start:number;end:number};
export function mergeTimeRanges(ranges:TimeRange[]):TimeRange[] {
  const merged:TimeRange[]=[];
  for(const range of [...ranges].sort((a,b)=>a.start-b.start)){
    const last=merged.at(-1);
    if(last&&range.start<=last.end+1e-7)last.end=Math.max(last.end,range.end);
    else merged.push({...range});
  }
  return merged;
}
export const clipTimeRanges=(clips:Clip[])=>mergeTimeRanges(clips.map(clip=>({start:clip.start,end:clip.start+clip.duration})));

/** Map genuinely omitted source intervals onto the original timeline, even after cuts move. */
export function removedFootageRanges(before:Timeline,after:Timeline):TimeRange[] {
  const removed:TimeRange[]=[];
  for(const clip of before.clips){
    if((clip.kind!=='video'&&clip.kind!=='image')||!clip.assetId)continue;
    const kept=mergeTimeRanges(after.clips.filter(next=>next.assetId===clip.assetId&&next.kind===clip.kind).map(next=>({start:next.sourceStart,end:sourceEndOf(next)})));
    const end=sourceEndOf(clip),rate=playbackRateOf(clip);let cursor=clip.sourceStart;
    for(const range of kept){
      if(range.end<=cursor||range.start>=end)continue;
      if(range.start>cursor)removed.push({start:clip.start+(cursor-clip.sourceStart)/rate,end:clip.start+(Math.min(end,range.start)-clip.sourceStart)/rate});
      cursor=Math.max(cursor,Math.min(end,range.end));
    }
    if(cursor<end-1e-7)removed.push({start:clip.start+(cursor-clip.sourceStart)/rate,end:clip.start+clip.duration});
  }
  return mergeTimeRanges(removed);
}
