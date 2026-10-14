import { deriveTracks, normalizeTimeline, type Timeline } from './types';
// OpenCut Classic timeline/components/layout.ts and track-layout.ts.
// MIT notice: third-party/OpenCut-LICENSE.
export const TIMELINE_RULER_HEIGHT=28;
// Time zero starts flush against the timeline lane's left edge.
export const TIMELINE_ORIGIN=0;
// Every lane has 3px above and below its clip, including track group boundaries.
export const TIMELINE_TRACK_GAP=6;
// A visible landing area makes adding a track above the stack easy to reach.
// Drag auto-scroll is measured at the ruler boundary, independently of this space.
export const TIMELINE_TOP_SPACE=24;
export const TIMELINE_BOTTOM_SPACE=72;
export function timelineLayout(timeline:Timeline,compact=false){
  timeline=normalizeTimeline(timeline);
  let top=TIMELINE_RULER_HEIGHT+TIMELINE_TOP_SPACE;
  const tracks=deriveTracks(timeline).map(track=>{
    const clipHeight=compact?24:52;
    const height=clipHeight+TIMELINE_TRACK_GAP;
    const row={...track,top,height,clipHeight,gapBefore:0};top+=height;return row;
  });
  return {tracks,height:top};
}
