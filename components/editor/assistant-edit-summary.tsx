'use client';
import { clipTimeRanges, removedFootageRanges, type TimeRange } from '@/lib/editor/edit-comparison';
import { formatTime, timelineDuration, type Timeline } from '@/lib/editor/types';
import type { SavedEditComparison } from './assistant-results';

function RangeLane({ranges,end,removed=[],kind='footage',label}:{ranges:TimeRange[];end:number;removed?:TimeRange[];kind?:'footage'|'captions'|'effects';label:string}){
  const path=(values:TimeRange[])=>values.map(range=>`M${range.start/end*280},0h${(range.end-range.start)/end*280}v20H${range.start/end*280}z`).join('');
  return <svg className={`assistant-mini-lane mini-${kind}`} viewBox="0 0 280 20" preserveAspectRatio="none" role="img" aria-label={label}><path d={path(ranges)}/>{removed.length>0&&<path className="mini-removed" d={path(removed)}><title>{removed.map(range=>`${formatTime(range.start)}–${formatTime(range.end)} removed`).join(', ')}</title></path>}</svg>;
}
function SnapshotLanes({timeline,end,removed=[],before=false}:{timeline:Timeline;end:number;removed?:TimeRange[];before?:boolean}){
  const footage=timeline.clips.filter(clip=>clip.kind==='video'||clip.kind==='image'),captions=timeline.clips.filter(clip=>clip.kind==='caption'||clip.kind==='graphic'),effects=timeline.clips.filter(clip=>clip.kind==='effect');
  const captionLabel=captions.every(clip=>clip.kind==='graphic')?'Titles':captions.every(clip=>clip.kind==='caption')?(captions.some(clip=>!!clip.textTemplate||!!clip.motion?.length||clip.animation==='fade'||clip.animation==='rise')?'Animated captions':'Captions'):'Captions and titles';
  return <div className={`assistant-mini-snapshot${before?' is-before':''}`}>
    {footage.length?<RangeLane ranges={clipTimeRanges(footage)} end={end} removed={removed} label={`${before?'Before':'After'} footage`}/>:<span className="mini-empty">No footage</span>}
    {captions.length>0&&<div className="assistant-mini-caption"><RangeLane ranges={clipTimeRanges(captions)} end={end} kind="captions" label={`${before?'Before':'After'} ${captionLabel.toLowerCase()}`}/><span>{captionLabel}</span></div>}
    {effects.length>0&&<RangeLane ranges={clipTimeRanges(effects)} end={end} kind="effects" label={`${before?'Before':'After'} effects`}/>}</div>;
}
export function AssistantEditSummary({comparison}:{comparison:SavedEditComparison}){
  const {before,after}=comparison;
  if(JSON.stringify(before.clips.filter(clip=>clip.kind!=='audio'))===JSON.stringify(after.clips.filter(clip=>clip.kind!=='audio')))return null;
  const end=Math.max(timelineDuration(before),timelineDuration(after),1),removed=removedFootageRanges(before,after);
  return <figure className="assistant-edit-comparison" aria-label="Saved timeline before and after"><div><span>Before</span><SnapshotLanes timeline={before} end={end} removed={removed} before/></div><div><span>After</span><SnapshotLanes timeline={after} end={end}/></div><figcaption>{formatTime(timelineDuration(before))}<span aria-hidden="true"> → </span>{formatTime(timelineDuration(after))}</figcaption></figure>;
}
