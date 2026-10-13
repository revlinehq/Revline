'use client';

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { dimensions, type Clip, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { layerZIndex } from '@/lib/editor/composition';
import { moveText, resizeText, snapTextMove, textPlacement, type TextPlacement } from '@/lib/editor/text-transforms';
import { projectPreviewBounds } from '@/lib/editor/preview-zoom';
import type { VisualCorner, VisualSnapLine } from '@/lib/editor/visual-transforms';
import { isPreviewTextOccluded, visualClipAtPoint } from '@/lib/editor/preview-viewport';
import { RotateCw } from 'lucide-react';
import { DEFAULT_TRANSFORM } from '@/lib/editor/types';
import { compositionNode } from '@/lib/editor/composition-node';
import './visual-controls.css';

type Bounds={id:string;left:number;top:number;width:number;height:number;z:number};
type Gesture={pointer:number;target:HTMLElement;clip:Clip;initial:TextPlacement;current:TextPlacement;x:number;y:number;width:number;height:number;bounds:Bounds;corner?:VisualCorner;rotation?:{initial:number;current:number;angle:number;cx:number;cy:number}};
type InlineEdit={id:string;original:string;draft:string};
const corners=[['nw','top left'],['ne','top right'],['sw','bottom left'],['se','bottom right']] as const;

// OpenCut Classic's preview interaction pattern: select on pointer down,
// update the rendered node while dragging, commit once, and discard on cancel.
// MIT notice: third-party/OpenCut-LICENSE.
export function TextControls({timeline,assets,time,revision,selected,activeId,onActivate,getDocument,onSelect,onCommit,onEdit}:{
  timeline:Timeline;assets:MediaAsset[];time:number;revision:number;selected?:string;activeId?:string;onActivate:(id:string)=>void;getDocument:()=>Document|null;
  onSelect:(id:string)=>void;onCommit:(id:string,patch:Partial<Clip>)=>void;onEdit?:(id:string)=>void;
}) {
  const root=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null);
  const [bounds,setBounds]=useState<Bounds[]>([]),[guides,setGuides]=useState<VisualSnapLine[]>([]);
  const [editing,setEditing]=useState<InlineEdit|null>(null);
  const inlineEdit=useRef<InlineEdit|null>(null);
  const latest=useRef({timeline,assets,time,getDocument,onSelect,onCommit,onEdit,activeId,onActivate});latest.current={timeline,assets,time,getDocument,onSelect,onCommit,onEdit,activeId,onActivate};
  function measure(){
    const doc=latest.current.getDocument(),composition=doc?.getElementById('composition'),host=root.current;
    if(!doc||!composition||!host)return;
    const canvas=composition.getBoundingClientRect(),layout={width:host.clientWidth,height:host.clientHeight};if(!canvas.width||!canvas.height||!layout.width||!layout.height)return;
    const next=latest.current.timeline.clips.flatMap((clip,index)=>{
      if(!['caption','graphic'].includes(clip.kind)||latest.current.time<clip.start||latest.current.time>=clip.start+clip.duration)return [];
      const node=compositionNode(doc,clip,index);if(!node)return [];
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
    const index=latest.current.timeline.clips.findIndex(c=>c.id===clip.id),doc=latest.current.getDocument(),node=doc?compositionNode(doc,clip,index):null;if(!node)return;
    node.style.left=`${placement.x*100}%`;node.style.top=`${placement.y*100}%`;node.style.fontSize=`${placement.fontSize}px`;measure();
  }
  function paintRotation(clip:Clip,rotation:number){
    const index=latest.current.timeline.clips.findIndex(c=>c.id===clip.id),doc=latest.current.getDocument(),node=doc?compositionNode(doc,clip,index):null;
    if(node)node.style.transform=`translate(-50%,-50%) rotate(${rotation}deg)`;
    measure();
  }
  function finish(cancel=false){
    const g=gesture.current;if(!g)return;gesture.current=null;setGuides([]);
    if(g.rotation){if(cancel)paintRotation(g.clip,g.rotation.initial);else if(g.rotation.initial!==g.rotation.current)latest.current.onCommit(g.clip.id,{transform:{...DEFAULT_TRANSFORM,...g.clip.transform,rotation:g.rotation.current}});}
    else if(cancel)paint(g.clip,g.initial);
    else if(g.initial.x!==g.current.x||g.initial.y!==g.current.y||g.initial.fontSize!==g.current.fontSize)latest.current.onCommit(g.clip.id,g.current);
    if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);
  }
  function finishInline(cancel=false){
    const edit=inlineEdit.current;if(!edit)return;
    inlineEdit.current=null;setEditing(null);
    if(!cancel&&edit.draft!==edit.original&&latest.current.timeline.clips.some(clip=>clip.id===edit.id))latest.current.onCommit(edit.id,{text:edit.draft});
  }
  function beginInline(clip:Clip){
    finish(true);finishInline();
    latest.current.onSelect(clip.id);latest.current.onActivate(clip.id);
    const edit={id:clip.id,original:clip.text??'',draft:clip.text??''};inlineEdit.current=edit;setEditing(edit);
  }
  useEffect(()=>{
    const edit=inlineEdit.current;if(!edit)return;
    const clip=timeline.clips.find(clip=>clip.id===edit.id);
    if(!clip||time<clip.start||time>=clip.start+clip.duration)finishInline(true);
  },[timeline.clips,time]);
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
    event.preventDefault();event.stopPropagation();
    const front=corner?undefined:footageAbove(clip,event);
    latest.current.onSelect(front?.id??clip.id);if(front||(latest.current.activeId!==clip.id&&selected!==clip.id))return;
    const screenBounds={...bounds,...projectPreviewBounds(bounds,{left:0,top:0,width:host.clientWidth,height:host.clientHeight},canvas)};
    const initial=textPlacement(clip);gesture.current={pointer:event.pointerId,target:event.currentTarget,clip,initial,current:initial,x:event.clientX,y:event.clientY,width:canvas.width,height:canvas.height,bounds:screenBounds,corner};event.currentTarget.setPointerCapture(event.pointerId);
  }
  function rotate(event:PointerEvent<HTMLElement>,clip:Clip,box:Bounds){
    start(event,clip,box,'nw');const g=gesture.current;if(!g)return;
    const cx=g.bounds.left+g.bounds.width/2,cy=g.bounds.top+g.bounds.height/2,initial=clip.transform?.rotation??0;
    g.rotation={initial,current:initial,cx,cy,angle:Math.atan2(event.clientY-cy,event.clientX-cx)*180/Math.PI};
  }
  function move(event:PointerEvent<HTMLElement>){
    const g=gesture.current;if(!g||g.pointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();
    if(g.rotation){
      const rotation=g.rotation,angle=Math.atan2(event.clientY-rotation.cy,event.clientX-rotation.cx)*180/Math.PI;
      const next=rotation.initial+((angle-rotation.angle+540)%360-180);
      rotation.current=Math.max(-360,Math.min(360,event.shiftKey?Math.round(next/15)*15:Math.round(next*100)/100));paintRotation(g.clip,rotation.current);return;
    }
    const dx=event.clientX-g.x,dy=event.clientY-g.y;
    if(Math.abs(dx)<2&&Math.abs(dy)<2&&g.current===g.initial)return;
    const proposed=g.corner?resizeText(g.initial,g.corner,dx,dy,g.bounds.width,g.bounds.height,g.width,g.height):moveText(g.initial,dx,dy,g.width,g.height,false);
    const result=!g.corner&&!event.shiftKey?snapTextMove(proposed,g.bounds,{width:g.width,height:g.height}):{placement:proposed,lines:[]};
    g.current=result.placement;paint(g.clip,g.current);setGuides(result.lines.map(line=>({...line,position:line.position/(line.axis==='x'?g.width:g.height)})));
  }
  return <div ref={root} className="text-controls" data-testid="text-controls" style={{zIndex:'auto'}}>
    {bounds.map(box=>{const clip=timeline.clips.find(c=>c.id===box.id);if(!clip)return null;
      if(editing?.id===clip.id){const width=Math.min(root.current?.clientWidth??box.width,Math.max(120,box.width)),height=Math.min(root.current?.clientHeight??box.height,Math.max(44,box.height));return <textarea key={box.id} autoFocus aria-label="Edit text in preview" title="Enter to save · Shift+Enter for a new line · Escape to cancel" className="preview-inline-text" maxLength={2000} value={editing.draft} style={{left:Math.max(0,Math.min(box.left,(root.current?.clientWidth??box.width)-width)),top:Math.max(0,Math.min(box.top,(root.current?.clientHeight??box.height)-height)),width,height,zIndex:box.z,fontSize:clip.fontSize??(clip.kind==='caption'?52:92)}} onFocus={event=>event.currentTarget.select()} onPointerDown={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onChange={event=>{const edit={...editing,draft:event.currentTarget.value};inlineEdit.current=edit;setEditing(edit);}} onBlur={()=>finishInline()} onKeyDown={event=>{
        event.stopPropagation();if(event.nativeEvent.isComposing)return;
        if(event.key==='Escape'){event.preventDefault();finishInline(true);}else if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();finishInline();}
      }}/>;}
      const active=activeId===clip.id||selected===clip.id;
      return <div key={box.id} role="button" tabIndex={0} aria-label={`Move text: ${clip.text||'Text'}`} aria-pressed={selected===clip.id} className={`text-selection-box ${active?'is-selected':''}`} style={{left:box.left,top:box.top,width:box.width,height:box.height,zIndex:box.z}} onPointerDown={e=>start(e,clip,box)} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)} onDoubleClick={event=>{event.stopPropagation();const front=footageAbove(clip,event);if(front){latest.current.onSelect(front.id);latest.current.onActivate(front.id);}else beginInline(clip);}} onKeyDown={event=>{
      if(event.target!==event.currentTarget)return;
      if(event.key==='Enter'){event.preventDefault();event.stopPropagation();latest.current.onSelect(clip.id);if(active)beginInline(clip);else latest.current.onActivate(clip.id);return;}
      const dx=event.key==='ArrowLeft'?-1:event.key==='ArrowRight'?1:0,dy=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:0;if((!dx&&!dy)||!active)return;
      event.preventDefault();event.stopPropagation();const canvas=root.current!.getBoundingClientRect(),step=event.shiftKey?10:1;const next=moveText(textPlacement(clip),dx*step,dy*step,canvas.width,canvas.height,false);latest.current.onSelect(clip.id);paint(clip,next);latest.current.onCommit(clip.id,next);
    }}>{active&&<><button type="button" className="text-rotation-handle" aria-label="Rotate text in preview" title="Drag to rotate · Shift snaps to 15°" onPointerDown={event=>rotate(event,clip,box)} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)} onDoubleClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;event.preventDefault();event.stopPropagation();const rotation=Math.max(-360,Math.min(360,(clip.transform?.rotation??0)+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?15:1)));latest.current.onCommit(clip.id,{transform:{...DEFAULT_TRANSFORM,...clip.transform,rotation}});}}><RotateCw size={13}/></button>{corners.map(([corner,label])=><button key={corner} type="button" className={`visual-corner visual-corner-${corner}`} aria-label={`Resize text ${label}`} onPointerDown={e=>start(e,clip,box,corner)} onPointerMove={move} onPointerUp={()=>finish()} onPointerCancel={()=>finish(true)} onLostPointerCapture={()=>finish(true)}><span/></button>)}</>}</div>;})}
    {guides.map(line=><div key={`${line.axis}-${line.position}`} className={`text-snap-guide ${line.axis==='x'?'vertical':'horizontal'}`} style={line.axis==='x'?{left:line.position===1?'calc(100% - 1px)':`${line.position*100}%`}:{top:line.position===1?'calc(100% - 1px)':`${line.position*100}%`}}/>)}
  </div>;
}
