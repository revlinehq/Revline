'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { dimensions, type Clip, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { layerZIndex } from '@/lib/editor/composition';
import { moveText, resizeText, snapTextMove, textPlacement, type TextPlacement } from '@/lib/editor/text-transforms';
import { projectPreviewBounds } from '@/lib/editor/preview-zoom';
import type { VisualCorner, VisualSnapLine } from '@/lib/editor/visual-transforms';
import { isPreviewTextOccluded, visualClipAtPoint } from '@/lib/editor/preview-viewport';
import './visual-controls.css';

type Bounds={id:string;left:number;top:number;width:number;height:number;z:number};
type Gesture={pointer:number;target:HTMLElement;clip:Clip;initial:TextPlacement;current:TextPlacement;x:number;y:number;width:number;height:number;bounds:Bounds;corner?:VisualCorner};
const corners=[['nw','top left'],['ne','top right'],['sw','bottom left'],['se','bottom right']] as const;

// OpenCut Classic's preview interaction pattern: select on pointer down,
// update the rendered node while dragging, commit once, and discard on cancel.
// MIT notice: third-party/OpenCut-LICENSE.
export function TextControls({timeline,assets,time,revision,selected,getDocument,onSelect,onCommit,onEdit,onPause}:{
  timeline:Timeline;assets:MediaAsset[];time:number;revision:number;selected?:string;getDocument:()=>Document|null;
  onSelect:(id:string)=>void;onCommit:(id:string,patch:Partial<Clip>)=>void;onEdit?:(id:string)=>void;onPause:()=>void;
}) {
  const root=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null);
  const [bounds,setBounds]=useState<Bounds[]>([]),[guides,setGuides]=useState<VisualSnapLine[]>([]);
  const latest=useRef({timeline,assets,time,getDocument,onSelect,onCommit,onEdit,onPause});latest.current={timeline,assets,time,getDocument,onSelect,onCommit,onEdit,onPause};
  function measure(){
    const doc=latest.current.getDocument(),composition=doc?.getElementById('composition'),host=root.current;
    if(!doc||!composition||!host)return;
    const canvas=composition.getBoundingClientRect(),layout={width:host.clientWidth,height:host.clientHeight};if(!canvas.width||!canvas.height||!layout.width||!layout.height)return;
    const next=latest.current.timeline.clips.flatMap((clip,index)=>{
      if(!['caption','graphic'].includes(clip.kind)||latest.current.time<clip.start||latest.current.time>=clip.start+clip.duration)return [];
      const node=doc.getElementById(`clip-${index}`);if(!node)return [];
      const rect=node.getBoundingClientRect();
      const sourceRect=projectPreviewBounds(rect,canvas,dimensions(latest.current.timeline.aspectRatio));
      if(isPreviewTextOccluded(latest.current.timeline,latest.current.assets,latest.current.time,clip.id,sourceRect))return [];
      return [{id:clip.id,...projectPreviewBounds(rect,canvas,layout),z:layerZIndex(clip,index)}];
    });
    setBounds(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  }
  useLayoutEffect(()=>{if(!gesture.current)measure();},[timeline,assets,time,revision,selected]);
  useEffect(()=>{const observer=new ResizeObserver(measure);if(root.current)observer.observe(root.current);const doc=getDocument();void doc?.fonts.ready.then(measure);return()=>observer.disconnect();},[revision]);
  function paint(clip:Clip,placement:TextPlacement){
    const index=latest.current.timeline.clips.findIndex(c=>c.id===clip.id),node=latest.current.getDocument()?.getElementById(`clip-${index}`);if(!node)return;
    node.style.left=`${placement.x*100}%`;node.style.top=`${placement.y*100}%`;node.style.fontSize=`${placement.fontSize}px`;measure();
  }
  function finish(cancel=false){
    const g=gesture.current;if(!g)return;gesture.current=null;setGuides([]);
    if(cancel)paint(g.clip,g.initial);
    else if(g.initial.x!==g.current.x||g.initial.y!==g.current.y||g.initial.fontSize!==g.current.fontSize)latest.current.onCommit(g.clip.id,g.current);
    if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);
  }
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopImmediatePropagation();finish(true);}};
    window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);finish(true);};
  },[]);
  function footageAbove(clip:Clip,event:{clientX:number;clientY:number}) {
    const host=root.current?.getBoundingClientRect();if(!host?.width||!host.height)return;
    const current=latest.current,canvas=dimensions(current.timeline.aspectRatio);
    const hit=visualClipAtPoint(current.timeline,current.assets,current.time,{x:(event.clientX-host.left)/host.width*canvas.width,y:(event.clientY-host.top)/host.height*canvas.height});
    const index=current.timeline.clips.findIndex(item=>item.id===clip.id),hitIndex=current.timeline.clips.findIndex(item=>item.id===hit?.id);
    return hit&&layerZIndex(hit,hitIndex)>layerZIndex(clip,index)?hit:undefined;
  }
  function start(event:PointerEvent<HTMLElement>,clip:Clip,bounds:Bounds,corner?:VisualCorner){
    if(event.button!==0)return;const host=root.current,canvas=host?.getBoundingClientRect();if(!host||!canvas?.width||!canvas.height||!host.clientWidth||!host.clientHeight)return;
    event.preventDefault();event.stopPropagation();latest.current.onPause();
    const front=corner?undefined:footageAbove(clip,event);
    latest.current.onSelect(front?.id??clip.id);if(front)return;
    const screenBounds={...bounds,...projectPreviewBounds(bounds,{left:0,top:0,width:host.clientWidth,height:host.clientHeight},canvas)};
    const initial=textPlacement(clip);gesture.current={pointer:event.pointerId,target:event.currentTarget,clip,initial,current:initial,x:event.clientX,y:event.clientY,width:canvas.width,height:canvas.height,bounds:screenBounds,corner};event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent<HTMLElement>){
    const g=gesture.current;if(!g||g.pointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();
    const dx=event.clientX-g.x,dy=event.clientY-g.y;
    if(Math.abs(dx)<2&&Math.abs(dy)<2&&g.current===g.initial)return;
    const proposed=g.corner?resizeText(g.initial,g.corner,dx,dy,g.bounds.width,g.bounds.height,g.width,g.height):moveText(g.initial,dx,dy,g.width,g.height,false);
    const result=!g.corner&&!event.shiftKey?snapTextMove(proposed,g.bounds,{width:g.width,height:g.height}):{placement:proposed,lines:[]};
    g.current=result.placement;paint(g.clip,g.current);setGuides(result.lines.map(line=>({...line,position:line.position/(line.axis==='x'?g.width:g.height)})));
  }
  return <div ref={root} className="text-controls" data-testid="text-controls" style={{zIndex:'auto'}}>
    {bounds.map(box=>{const clip=timeline.clips.find(c=>c.id===box.id);if(!clip)return null;return <div key={box.id} role="button" tabIndex={0} aria-label={`Move text: ${clip.text||'Text'}`} aria-pressed={selected===clip.id} className={`text-selection-box ${selected===clip.id?'is-selected':''}`} style={{left:box.left,top:box.top,width:box.width,height:box.height,zIndex:box.z}} onPointerDown={e=>start(e,clip,box)} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)} onDoubleClick={event=>{const front=footageAbove(clip,event);if(front)latest.current.onSelect(front.id);else latest.current.onEdit?.(clip.id);}} onKeyDown={event=>{
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();latest.current.onSelect(clip.id);latest.current.onEdit?.(clip.id);return;}
      const dx=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,dy=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;if(!dx&&!dy)return;
      event.preventDefault();event.stopPropagation();const canvas=root.current!.getBoundingClientRect(),step=event.shiftKey?10:1;const next=moveText(textPlacement(clip),dx*step,dy*step,canvas.width,canvas.height,false);latest.current.onPause();latest.current.onSelect(clip.id);paint(clip,next);latest.current.onCommit(clip.id,next);
    }}>{selected===clip.id&&corners.map(([corner,label])=><button key={corner} type="button" className={`visual-corner visual-corner-${corner}`} aria-label={`Resize text ${label}`} onPointerDown={e=>start(e,clip,box,corner)} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}><span/></button>)}</div>;})}
    {guides.map(line=><div key={`${line.axis}-${line.position}`} className={`text-snap-guide ${line.axis==='x'?'vertical':'horizontal'}`} style={line.axis==='x'?{left:line.position===1?'calc(100% - 1px)':`${line.position*100}%`}:{top:line.position===1?'calc(100% - 1px)':`${line.position*100}%`}}/>)}
  </div>;
}
