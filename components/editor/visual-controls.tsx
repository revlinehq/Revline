'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { type Clip, type VisualTransform } from '@/lib/editor/types';
import { moveVisualTransform, resizeVisualTransform, sameVisualTransform, snapVisualMove, snapVisualResize, visualResizeCursor, visualTransform, type VisualCorner, type VisualRect, type VisualSnapLine } from '@/lib/editor/visual-transforms';
import { visibleVisualBounds } from '@/lib/editor/preview-viewport';
import './visual-controls.css';

type Gesture={pointer:number;target:HTMLElement;x:number;y:number;width:number;height:number;canvas:{width:number;height:number};contentRect:VisualRect;initial:VisualTransform;corner?:VisualCorner;current:VisualTransform};
const corners=[['nw','top left'],['ne','top right'],['sw','bottom left'],['se','bottom right']] as const;
export function VisualHandles({clip,canvas,contentRect,onCommit,onPreview,onEdit}:{clip:Clip;canvas:{width:number;height:number};contentRect:VisualRect;onCommit:(transform:VisualTransform)=>void;onPreview?:(transform:VisualTransform)=>void;onEdit?:()=>void}){
  const root=useRef<HTMLDivElement>(null),gesture=useRef<Gesture|null>(null);
  const [draft,setDraft]=useState<VisualTransform|null>(null);
  const [guides,setGuides]=useState<VisualSnapLine[]>([]);
  const [displayRatio,setDisplayRatio]=useState(1);
  const latest=useRef({onPreview,onCommit});latest.current={onPreview,onCommit};
  const transform=draft??visualTransform(clip.transform);
  const contentVisible=visibleVisualBounds(transform,contentRect,canvas);
  // Retain the captured target while a drag takes the media fully off-frame.
  const visible=contentVisible??(gesture.current?visibleVisualBounds(gesture.current.initial,contentRect,canvas):null);
  const angle=(visible?.clipped?0:transform.rotation)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  const selectionStyle=visible?{left:`${visible.rect.left/canvas.width*100}%`,top:`${visible.rect.top/canvas.height*100}%`,width:`${visible.rect.width/canvas.width*100}%`,height:`${visible.rect.height/canvas.height*100}%`} as CSSProperties:undefined;
  const polygon=visible?.points.map(point=>`${(point.x-visible.rect.left)/visible.rect.width*100}% ${(point.y-visible.rect.top)/visible.rect.height*100}%`).join(',');
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;
    const measure=()=>{const rect=element.getBoundingClientRect();if(rect.width&&rect.height)setDisplayRatio((rect.height/canvas.height)/(rect.width/canvas.width));};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[canvas.width,canvas.height]);
  function settle(cancel=false){
    const g=gesture.current;if(!g)return;gesture.current=null;
    if(cancel||sameVisualTransform(g.initial,g.current))latest.current.onPreview?.(g.initial);else latest.current.onCommit(g.current);
    if(g.target.hasPointerCapture(g.pointer))g.target.releasePointerCapture(g.pointer);
    setDraft(null);setGuides([]);
  }
  useEffect(()=>{
    const cancel=(event:KeyboardEvent)=>{if(event.key==='Escape'&&gesture.current){event.preventDefault();event.stopImmediatePropagation();settle(true);}};
    window.addEventListener('keydown',cancel,true);return()=>{window.removeEventListener('keydown',cancel,true);settle(true);};
  },[]);
  function start(e:PointerEvent<HTMLElement>,corner?:VisualCorner){
    if(e.button!==0)return;
    const bounds=root.current?.getBoundingClientRect();if(!bounds?.width||!bounds.height)return;
    e.preventDefault();e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);
    const initial=visualTransform(clip.transform);gesture.current={pointer:e.pointerId,target:e.currentTarget,x:e.clientX,y:e.clientY,width:bounds.width,height:bounds.height,canvas,contentRect,initial,corner,current:initial};
    setDraft(initial);setGuides([]);onPreview?.(initial);
  }
  function move(e:PointerEvent<HTMLElement>){
    const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;e.preventDefault();e.stopPropagation();
    const dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(Math.abs(dx)<2&&Math.abs(dy)<2&&sameVisualTransform(g.initial,g.current))return;
    const proposed=g.corner?resizeVisualTransform(g.initial,g.corner,dx/g.width*g.canvas.width,dy/g.height*g.canvas.height,g.canvas.width,g.canvas.height,g.contentRect):moveVisualTransform(g.initial,dx,dy,g.width,g.height);
    const viewport={width:g.width,height:g.height};
    const result=e.shiftKey?{transform:proposed,lines:[]}:g.corner?snapVisualResize(g.initial,proposed,g.corner,g.contentRect,g.canvas,viewport):snapVisualMove(proposed,g.contentRect,g.canvas,viewport);
    g.current=result.transform;setDraft(result.transform);setGuides(result.lines);onPreview?.(result.transform);
  }
  function finish(e:PointerEvent<HTMLElement>,cancel=false){if(gesture.current?.pointer!==e.pointerId)return;e.stopPropagation();settle(cancel);}
  return <div ref={root} className="visual-handles" style={{opacity:contentVisible?undefined:0}} data-testid="visual-handles" onKeyDown={e=>{const step=e.shiftKey ? .1 : .01;let next:VisualTransform|undefined;if(e.key==='ArrowLeft')next=moveVisualTransform(transform,-step,0,1,1);if(e.key==='ArrowRight')next=moveVisualTransform(transform,step,0,1,1);if(e.key==='ArrowUp')next=moveVisualTransform(transform,0,-step,1,1);if(e.key==='ArrowDown')next=moveVisualTransform(transform,0,step,1,1);if(next){e.preventDefault();e.stopPropagation();if(!sameVisualTransform(transform,next)){onPreview?.(next);onCommit(next);}}}}>{visible&&<>
    <div className="visual-selection-box" role="button" tabIndex={0} aria-label="Move selected layer" style={{...selectionStyle,clipPath:`polygon(${polygon})`}} onDoubleClick={event=>{event.preventDefault();event.stopPropagation();onEdit?.();}} onPointerDown={e=>start(e)} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e)}/>
    <svg className="visual-selection-outline" style={selectionStyle} viewBox={`0 0 ${visible.rect.width} ${visible.rect.height}`} preserveAspectRatio="none" aria-hidden="true"><polygon points={visible.points.map(point=>`${point.x-visible.rect.left},${point.y-visible.rect.top}`).join(' ')} fill="none" vectorEffect="non-scaling-stroke"/></svg>
    <div className="visual-resize-layer">{corners.map(([corner,label])=>{const point=visible.corners[corner],sx=corner.endsWith('e')?1:-1,sy=corner.startsWith('s')?1:-1;const cx=visible.rect.left+visible.rect.width/2,cy=visible.rect.top+visible.rect.height/2;const cursor=visualResizeCursor(Math.atan2((point.y-cy)*displayRatio,point.x-cx)*180/Math.PI);return <button key={corner} type="button" className={`visual-corner visual-corner-${corner}`} style={{left:`calc(${point.x/canvas.width*100}% + ${(sx*cos-sy*sin)*5}px / var(--preview-view-scale,1))`,top:`calc(${point.y/canvas.height*100}% + ${(sx*sin+sy*cos)*5}px / var(--preview-view-scale,1))`,cursor}} aria-label={`Resize ${label}`} onPointerDown={e=>start(e,corner)} onPointerMove={move} onPointerUp={e=>finish(e)} onPointerCancel={e=>finish(e,true)} onLostPointerCapture={e=>finish(e)}><span/></button>;})}</div>
  </>}{guides.map(line=><div key={`${line.axis}-${line.position}`} className={`visual-snap-guide ${line.axis==='x'?'vertical':'horizontal'}`} data-axis={line.axis} data-position={line.position} aria-hidden="true" style={line.axis==='x'?{left:line.position===canvas.width?'calc(100% - 1px)':`${line.position/canvas.width*100}%`}:{top:line.position===canvas.height?'calc(100% - 1px)':`${line.position/canvas.height*100}%`}}/>)}</div>;
}
