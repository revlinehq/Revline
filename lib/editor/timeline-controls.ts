// Adapted from OpenCut Classic's playhead, zoom, and edge-scroll controllers.
// Copyright 2025–2026 OpenCut. MIT: third-party/OpenCut-LICENSE.
import { layerGroup,trackOf,deriveTrackCounts,normalizeTimeline,maxTrackCount,type Timeline,type LayerGroup,type MediaAsset,type Clip } from './types';
import { frameSeekTime, linkedClipIds } from './operations';
import { TimelineGestureRejection } from './timeline-edit-errors';
export function timelineTimeAtPointer(x:number,geometry:{left:number;scrollLeft:number;origin:number;px:number;end:number;fps:number;marks?:number[]}){
  const raw=Math.max(0,Math.min(geometry.end,(x-geometry.left+geometry.scrollLeft-geometry.origin)/geometry.px));
  const at=geometry.marks?closestSnap(raw,geometry.marks,7/geometry.px):raw;
  return frameSeekTime(at,geometry.fps,geometry.end);
}
export function closestSnap(value:number,marks:number[],threshold:number){
  let best=value;let distance=threshold;
  for(const mark of marks){const next=Math.abs(mark-value);if(next<distance){best=mark;distance=next;}}
  return best;
}
/** A moving selection can magnetize either end of any selected clip. */
export function snapMoveDelta(delta:number,members:Clip[],marks:number[],threshold:number){
  let correction=0,distance=threshold;
  for(const clip of members)for(const edge of [clip.start,clip.start+clip.duration])for(const mark of marks){
    const offset=mark-edge-delta;const next=Math.abs(offset);
    if(next<distance){correction=offset;distance=next;}
  }
  return Math.abs(correction)<1e-9?delta:delta+correction;
}
export type TimelineMagnet={marks:number[];threshold:number};
export function edgeScrollSpeed(pointerX:number,left:number,width:number,scrollLeft:number,maxScroll:number){
  const relative=pointerX-left;const edge=Math.min(80,width/4);
  if(relative<edge&&scrollLeft>0)return -15*(1-Math.max(0,relative)/edge);
  if(relative>width-edge&&scrollLeft<maxScroll)return 15*(1-Math.max(0,width-relative)/edge);
  return 0;
}
export function zoomAtAnchor(oldZoom:number,newZoom:number,scrollLeft:number,anchorX:number){
  return Math.max(0,(scrollLeft+anchorX)*newZoom/oldZoom-anchorX);
}
export function reorderLayer(timeline:Timeline,group:LayerGroup,from:number,to:number):Timeline{
  timeline=normalizeTimeline(timeline);
  const counts=deriveTrackCounts(timeline);
  if(from===to)return timeline;
  if(!Number.isInteger(from)||!Number.isInteger(to)||Math.min(from,to)<1||from>counts[group]||to>Math.min(maxTrackCount(group),counts[group]+1))throw new Error('Choose a layer in this group.');
  return {...timeline,tracks:{...counts,[group]:Math.max(counts[group],to)},clips:timeline.clips.map(clip=>{
    if(layerGroup(clip.kind)!==group)return clip;
    const current=trackOf(clip);let track=current;
    if(current===from)track=to;
    else if(from<to&&current>from&&current<=to)track=current-1;
    else if(from>to&&current>=to&&current<from)track=current+1;
    return {...clip,track};
  })};
}

/** Remove an empty row and keep the remaining layer numbers contiguous. */
export function deleteEmptyLayer(timeline:Timeline,group:LayerGroup,number:number):Timeline {
  timeline=normalizeTimeline(timeline);
  const counts=deriveTrackCounts(timeline);
  if(number<1||number>counts[group])throw new Error('Choose an existing layer.');
  if(timeline.clips.some(clip=>layerGroup(clip.kind)===group&&trackOf(clip)===number))throw new Error('Remove the clips before deleting this layer.');
  return {...timeline,tracks:{...counts,[group]:counts[group]-1},clips:timeline.clips.map(clip=>layerGroup(clip.kind)===group&&trackOf(clip)>number?{...clip,track:trackOf(clip)-1}:clip)};
}
/** Remove every empty row while keeping occupied rows in their compositing order. */
export function removeEmptyLayers(timeline: Timeline): Timeline {
  timeline=normalizeTimeline(timeline);
  const counts = deriveTrackCounts(timeline);
  const occupied = { visual: new Set<number>(), overlay: new Set<number>(), audio: new Set<number>() };
  for (const clip of timeline.clips) occupied[layerGroup(clip.kind)].add(trackOf(clip));
  const groups = ['visual', 'audio'] as const;
  if (groups.every(group => occupied[group].size === counts[group])) return timeline;
  const mappings = Object.fromEntries(groups.map(group => [group, new Map([...occupied[group]].sort((a, b) => a - b).map((number, index) => [number, index + 1]))])) as Record<LayerGroup, Map<number, number>>;
  return {
    ...timeline,
    tracks: { visual: occupied.visual.size, overlay: occupied.overlay.size, audio: occupied.audio.size },
    clips: timeline.clips.map(clip => {
      const track = mappings[layerGroup(clip.kind)].get(trackOf(clip))!;
      return track === trackOf(clip) ? clip : { ...clip, track };
    }),
  };
}

/** Resolve collisions by inserting layers, preserving the clips already there. */
function placeMovedClips(timeline:Timeline,moved:import('./types').Clip[],direction:'above'|'below'='above',createLayers=true):Timeline {
  const movingIds=new Set(moved.map(clip=>clip.id));
  let rest=timeline.clips.filter(clip=>!movingIds.has(clip.id));
  const counts=deriveTrackCounts(timeline);
  for(const group of ['visual','audio'] as const){
    const members=moved.filter(clip=>layerGroup(clip.kind)===group);if(!members.length)continue;
    const collides=members.some(clip=>rest.some(other=>layerGroup(other.kind)===group&&trackOf(other)===trackOf(clip)&&other.start<clip.start+clip.duration-1e-6&&clip.start<other.start+other.duration-1e-6));
    if(!collides)continue;
    if(!createLayers)throw new TimelineGestureRejection('Overlaps a clip');
    const first=Math.min(...members.map(trackOf));const last=Math.max(...members.map(trackOf));const span=last-first+1;const insert=first+(direction==='above'?1:0);
    if(Math.max(counts[group]+span,last+(direction==='above'?1:0))>maxTrackCount(group))throw new Error(`This group already has ${maxTrackCount(group)} layers. Remove an empty layer before adding another.`);
    rest=rest.map(clip=>layerGroup(clip.kind)===group&&trackOf(clip)>=insert?{...clip,track:trackOf(clip)+span}:clip);
    moved=moved.map(clip=>layerGroup(clip.kind)===group?{...clip,track:trackOf(clip)+(direction==='above'?1:0)}:clip);
    counts[group]+=span;
  }
  const placed=new Map([...rest,...moved].map(clip=>[clip.id,clip]));
  const next={...timeline,tracks:counts,clips:timeline.clips.map(clip=>placed.get(clip.id)??clip)};
  return {...next,tracks:deriveTrackCounts(next)};
}
export function moveClipToLayer(timeline:Timeline,clip:import('./types').Clip):Timeline {
  timeline=normalizeTimeline(timeline);
  return placeMovedClips(timeline,[clip]);
}

export type SelectionBounds={left:number;top:number;width:number;height:number};
export function intersectsSelection(a:SelectionBounds,b:SelectionBounds){return a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;}
export function shouldCommitClipGesture(mode:'move'|'left'|'right',pointer:{x:number;y:number},viewport:SelectionBounds){
  // A trim is one-dimensional and its timing is already clamped. Releasing past
  // zero must keep that preview; only moving a clip needs an inside drop target.
  return mode!=='move'||pointer.x>=viewport.left&&pointer.x<viewport.left+viewport.width&&pointer.y>=viewport.top&&pointer.y<viewport.top+viewport.height;
}
function selectedMoveDelta(timeline: Timeline, members: import('./types').Clip[], requested: number, anchorId?: string, magnet?: TimelineMagnet) {
  const minimum = -Math.min(...members.map(clip => clip.start));
  const maximum = 300 - Math.max(...members.map(clip => clip.start + clip.duration));
  const delta = Math.max(minimum, Math.min(maximum, requested));
  if (delta === 0) return 0;
  const anchor = members.find(clip => clip.id === anchorId) ?? members[0];
  const frameDelta = Math.round((anchor.start + delta) * timeline.fps) / timeline.fps - anchor.start;
  // Imported clip endpoints can fall between frames. Magnetize after rounding
  // so an exact join cannot become a tiny overlap and create another track.
  const snapped = magnet ? snapMoveDelta(frameDelta, members, magnet.marks, magnet.threshold) : frameDelta;
  return Math.max(minimum, Math.min(maximum, snapped));
}

export function moveSelectedClips(timeline:Timeline,ids:string[],timeDelta:number,layerDelta:number,direction:'above'|'below'='above',anchorId?:string,magnet?:TimelineMagnet):Timeline {
  timeline=normalizeTimeline(timeline);
  const explicit=new Set(ids);const linked=new Set(linkedClipIds(timeline,ids));
  const members=timeline.clips.filter(c=>linked.has(c.id));if(!members.length)return timeline;
  const anchorGroup=layerGroup(members.find(c=>c.id===anchorId)?.kind??members[0].kind);
  const layers=members.filter(c=>explicit.has(c.id)&&(!c.linkedClipId||layerGroup(c.kind)===anchorGroup));
  const dt=selectedMoveDelta(timeline,members,timeDelta,anchorId,magnet);
  const dl=Math.max(1-Math.min(...layers.map(trackOf)),Math.min(Math.min(...layers.map(clip=>maxTrackCount(layerGroup(clip.kind))-trackOf(clip))),layerDelta));
  const moved=members.map(c=>({...c,start:dt===0?c.start:c.start+dt,track:trackOf(c)+(layers.some(member=>member.id===c.id)?dl:0)}));
  return placeMovedClips(timeline,moved,direction,false);
}

/** Dropping outside a group's stack creates rows on that side in one undoable edit. */
export function moveSelectionToNewLayers(timeline:Timeline,ids:string[],timeDelta:number,edge:'above'|'below',anchorId?:string,magnet?:TimelineMagnet):Timeline {
  timeline=normalizeTimeline(timeline);
  const selected=new Set(linkedClipIds(timeline,ids));const explicit=new Set(ids);
  const members=timeline.clips.filter(clip=>selected.has(clip.id));if(!members.length)return timeline;
  const anchorGroup=layerGroup(members.find(c=>c.id===anchorId)?.kind??members[0].kind);
  const counts=deriveTrackCounts(timeline);
  const dt=selectedMoveDelta(timeline,members,timeDelta,anchorId,magnet);
  let clips=timeline.clips.map(clip=>selected.has(clip.id)?{...clip,start:dt===0?clip.start:clip.start+dt}:clip);
  for(const group of ['visual','audio'] as const){
    const groupMembers=members.filter(clip=>explicit.has(clip.id)&&layerGroup(clip.kind)===group&&(!clip.linkedClipId||group===anchorGroup));if(!groupMembers.length)continue;
    const first=Math.min(...groupMembers.map(trackOf));const last=Math.max(...groupMembers.map(trackOf));const span=last-first+1;
    if(counts[group]+span>maxTrackCount(group))throw new Error(`This group already has ${maxTrackCount(group)} layers. Remove an empty layer before adding another.`);
    const originalCount=counts[group];counts[group]+=span;
    clips=clips.map(clip=>{
      if(layerGroup(clip.kind)!==group)return clip;
      if(groupMembers.some(member=>member.id===clip.id))return {...clip,track:(edge==='above'?originalCount+1:1)+trackOf(clip)-first};
      return edge==='below'?{...clip,track:trackOf(clip)+span}:clip;
    });
  }
  return {...timeline,tracks:counts,clips};
}

export type LayerDropTarget={edge:'above'|'below'}|{track:number;direction:'above'|'below'};
export function layerDropTarget(pointerY:number,rows:{top:number;bottom:number;track:number}[]):LayerDropTarget|null {
  if(!rows.length)return null;
  if(pointerY<rows[0].top)return {edge:'above'};
  if(pointerY>=rows[rows.length-1].bottom)return {edge:'below'};
  const row=rows.find(row=>pointerY>=row.top&&pointerY<row.bottom);
  return row?{track:row.track,direction:pointerY<(row.top+row.bottom)/2?'above':'below'}:null;
}
/** Crossing the other stack is an invalid drop, not a new row in this group. */
export function clipLayerDropTarget(pointerY:number,rows:{top:number;bottom:number;track:number;group:LayerGroup}[],group:LayerGroup):LayerDropTarget|null {
  const target=rows.find(row=>pointerY>=row.top&&pointerY<row.bottom);
  if(target&&target.group!==group)return null;
  const members=rows.filter(row=>row.group===group);
  if(!members.length)return null;
  if(pointerY<members[0].top&&rows.some(row=>row.group!==group&&row.top<members[0].top))return null;
  if(pointerY>=members[members.length-1].bottom&&rows.some(row=>row.group!==group&&row.bottom>members[members.length-1].bottom))return null;
  // Slightly missing a row should keep that row, not grow the stack.
  if(pointerY<members[0].top&&pointerY>members[0].top-6)return {track:members[0].track,direction:'above'};
  const last=members[members.length-1];
  if(pointerY>=last.bottom&&pointerY<last.bottom+6)return {track:last.track,direction:'below'};
  return layerDropTarget(pointerY,members);
}

/** OpenCut's shared edge delta: clamp against neighbors and real source extents. */
export function resizeSelectedClips(timeline:Timeline,assets:MediaAsset[],ids:string[],side:'left'|'right',delta:number,magnet?:TimelineMagnet):Timeline {
  timeline=normalizeTimeline(timeline);
  const selected=new Set(linkedClipIds(timeline,ids));const members=timeline.clips.filter(clip=>selected.has(clip.id));
  if(!members.length)return timeline;
  const sources=new Map(assets.map(asset=>[asset._id,asset]));const frame=1/timeline.fps;
  let minimum=-Infinity,maximum=Infinity;
  for(const clip of members){
    const neighbors=timeline.clips.filter(other=>other.id!==clip.id&&layerGroup(other.kind)===layerGroup(clip.kind)&&trackOf(other)===trackOf(clip));
    const end=clip.start+clip.duration;
    const left=Math.max(0,...neighbors.filter(other=>other.start+other.duration<=clip.start+1e-6).map(other=>other.start+other.duration));
    const right=Math.min(Infinity,...neighbors.filter(other=>other.start>=end-1e-6).map(other=>other.start));
    const asset=sources.get(clip.assetId??'');const timedSource=clip.kind==='video'||clip.kind==='audio';
    if(side==='left'){
      minimum=Math.max(minimum,left-clip.start,timedSource?-clip.sourceStart:-Infinity);
      maximum=Math.min(maximum,clip.duration-frame);
    }else{
      minimum=Math.max(minimum,frame-clip.duration);
      maximum=Math.min(maximum,300-end,right-end,timedSource&&asset?.duration!==undefined?asset.duration-clip.sourceStart-clip.duration:Infinity);
    }
  }
  // Imported timings/source limits can fall between project frames. Once the
  // pointer reaches a real limit, keep it exact instead of rounding back inside
  // the interval and leaving a gap at zero (or unused footage at source zero).
  let dt=delta<=minimum?minimum:delta>=maximum?maximum:Math.max(minimum,Math.min(maximum,Math.round(delta*timeline.fps)/timeline.fps));
  if(magnet){
    const anchor=members.find(clip=>clip.id===ids[0])??members[0];
    const edge=anchor.start+(side==='right'?anchor.duration:0)+dt;
    dt=Math.max(minimum,Math.min(maximum,dt+closestSnap(edge,magnet.marks,magnet.threshold)-edge));
  }
  return {...timeline,clips:timeline.clips.map(clip=>{
    if(!selected.has(clip.id))return clip;
    const rawDuration=clip.duration+(side==='right'?dt:-dt);
    // Subtracting the edge delta can round a valid one-frame clip below its minimum.
    const tolerance=Number.EPSILON*Math.max(1,clip.duration,Math.abs(dt))*8;
    const duration=Math.abs(rawDuration-frame)<=tolerance?frame:rawDuration;
    return side==='right'?{...clip,duration}:{...clip,start:clip.start+dt,duration,sourceStart:clip.kind==='video'||clip.kind==='audio'?clip.sourceStart+dt:clip.sourceStart};
  })};
}
