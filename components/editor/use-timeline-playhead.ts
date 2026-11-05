'use client';
import { useEffect, type RefObject } from 'react';
import { edgeScrollSpeed } from '@/lib/editor/timeline-controls';
import { verticalEdgeScrollSpeed } from '@/lib/editor/timeline-autoscroll';
import { TIMELINE_RULER_HEIGHT } from '@/lib/editor/timeline-layout';

export function paintPlayhead(element: HTMLDivElement | null, x: number, viewport: HTMLDivElement | null, cap: HTMLDivElement | null) {
  if (!element) return;
  element.style.transform = `translate3d(${x}px,0,0)`;
  if (cap && viewport) {
    // The cap lives outside the scrolling lane so its full shape can extend
    // over the empty header corner while time zero stays against the wall.
    const offset=x-viewport.scrollLeft;
    cap.style.transform=`translate3d(${viewport.offsetLeft+offset+(element.offsetWidth-cap.offsetWidth)/2}px,0,0)`;
    // At the physical right edge there is no header corner to extend into.
    // Hide a clipped cap rather than shifting its point away from the line.
    const right=offset+(element.offsetWidth+cap.offsetWidth)/2;
    cap.style.visibility=viewport.clientWidth>0&&offset>=0&&right<=viewport.clientWidth?'visible':'hidden';
  }
}

// OpenCut's imperative playhead pattern, adapted to HyperFrames' frame clock.
// MIT attribution: NOTICE.
export function useTimelinePlayhead({time,playing,readTime,px,duration,origin,viewport,head,cap,scrubbing,followPausedUntil}:{
  time:number;playing:boolean;readTime?:()=>number;px:number;duration:number;origin:number;
  viewport:RefObject<HTMLDivElement|null>;head:RefObject<HTMLDivElement|null>;cap:RefObject<HTMLDivElement|null>;scrubbing:RefObject<boolean>;followPausedUntil?:RefObject<number>;
}){
  useEffect(()=>{if(!playing&&!scrubbing.current)paintPlayhead(head.current, origin+Math.min(readTime?.()??time,duration)*px,viewport.current,cap.current);},[time,playing,readTime,px,duration,origin,head,cap,viewport,scrubbing]);
  useEffect(()=>{
    const el=viewport.current;if(!el)return;
    const sync=()=>{const x=Number.parseFloat(head.current?.style.transform.slice('translate3d('.length)??'0');paintPlayhead(head.current,Number.isFinite(x)?x:0,el,cap.current);};
    el.addEventListener('scroll',sync,{passive:true});
    const observer=new ResizeObserver(sync);observer.observe(el);
    return()=>{el.removeEventListener('scroll',sync);observer.disconnect();};
  },[viewport,head,cap]);
  useEffect(()=>{
    if(!playing||!readTime)return;
    let frame=0;
    function tick(){
      if(!scrubbing.current){const x=origin+Math.min(readTime!(),duration)*px;
        const el=viewport.current;if(el&&performance.now()>=(followPausedUntil?.current??0)&&(x>el.scrollLeft+el.clientWidth-20||x<el.scrollLeft))el.scrollLeft=Math.max(0,x-el.clientWidth*.6);
        paintPlayhead(head.current,x,el,cap.current);
      }
      frame=requestAnimationFrame(tick);
    }
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[playing,readTime,px,duration,origin,viewport,head,cap,scrubbing,followPausedUntil]);
}

// Scrubbing keeps pointer capture across panels, but must not scroll their edges.
// Its horizontal Y bound is separate from pointerY, which enables vertical scrolling.
export function useEdgeAutoScroll(active:boolean,viewport:RefObject<HTMLDivElement|null>,pointer:RefObject<number>,pointerY?:RefObject<number>,onScroll?:RefObject<(()=>void)|null>,horizontal=true,horizontalPointerY?:RefObject<number>){
  useEffect(()=>{
    if(!active)return;let frame=0;
    function tick(){const el=viewport.current;if(el){const beforeX=el.scrollLeft,beforeY=el.scrollTop;const rect=el.getBoundingClientRect();const max=Math.max(0,el.scrollWidth-el.clientWidth);const withinHorizontalRegion=!horizontalPointerY||(horizontalPointerY.current>=rect.top&&horizontalPointerY.current<=rect.bottom);const speed=horizontal&&withinHorizontalRegion?edgeScrollSpeed(pointer.current,rect.left,rect.width,el.scrollLeft,max):0;if(speed)el.scrollLeft=Math.max(0,Math.min(max,el.scrollLeft+speed));if(pointerY){const maxY=Math.max(0,el.scrollHeight-el.clientHeight);const vertical=verticalEdgeScrollSpeed(pointerY.current,rect.top+TIMELINE_RULER_HEIGHT,rect.top+el.clientHeight,el.scrollTop,maxY);if(vertical)el.scrollTop=Math.max(0,Math.min(maxY,el.scrollTop+vertical));}if(el.scrollLeft!==beforeX||el.scrollTop!==beforeY)onScroll?.current?.();}frame=requestAnimationFrame(tick);}
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[active,viewport,pointer,pointerY,onScroll,horizontal,horizontalPointerY]);
}
