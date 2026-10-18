'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { cameraMotionPatch } from '@/lib/editor/camera-motion';
import type { CameraMotionSettings } from '@/lib/editor/camera-motion-settings';
import { CAMERA_ZOOM_RANGE, SMOOTH_ZOOM_EASINGS } from '@/lib/editor/smooth-zoom-settings';
import type { AspectRatio, Clip, MediaAsset } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import { InspectorSelect } from './inspector-select';
import './camera-motion-controls.css';

type Props = {clip:Clip;asset:MediaAsset;aspectRatio:AspectRatio;fps:number;disabled?:boolean;onChange:(patch:Partial<Clip>)=>void;onPreview?:(patch:Partial<Clip>|null)=>void;onSeek?:(time:number)=>void};
type Point = CameraMotionSettings['keyframes'][number];
const labels = {'linear':'Linear','ease-out':'Ease out','ease-in-out':'Ease in / out','focused-spring':'Focused spring'};
function initial(clip:Clip):CameraMotionSettings {
  if(clip.cameraMotion && !clip.motionOffset)return {...clip.cameraMotion,keyframes:clip.cameraMotion.keyframes.map(key=>({...key}))};
  return {keyframes:[{time:0,scale:1,centerX:.5,centerY:.5,easing:'focused-spring'},{time:clip.duration,scale:1,centerX:.5,centerY:.5,easing:'focused-spring'}]};
}

/** Authoring is local-only; the agent and renderers share the canonical motion keys. */
export function CameraMotionControls(props:Props){
  return process.env.NODE_ENV!=='production'?<DevelopmentCameraMotion {...props}/>:null;
}
function DevelopmentCameraMotion({clip,asset,aspectRatio,fps,disabled=false,onChange,onPreview,onSeek}:Props){
  const [settings,setSettings]=useState(()=>initial(clip));
  const [replace,setReplace]=useState(false),[error,setError]=useState('');
  const previewRef=useRef(onPreview);previewRef.current=onPreview;
  useEffect(()=>{setSettings(initial(clip));setReplace(false);setError('');},[clip.id,clip.cameraMotion,clip.motionOffset,clip.duration]);
  useEffect(()=>()=>previewRef.current?.(null),[]);
  useEffect(()=>{if(disabled)previewRef.current?.(null);},[disabled]);
  const custom=!!clip.motion?.length&&!clip.cameraMotion&&!clip.smoothZoom;
  const change=(index:number,patch:Partial<Point>)=>{setSettings(previous=>({...previous,keyframes:previous.keyframes.map((key,i)=>i===index?{...key,...patch}:key)}));setError('');};
  function apply(preview=false){
    if(disabled)return;
    try{const patch=cameraMotionPatch(clip,asset,aspectRatio,settings,{replace});if(preview)onPreview?.(patch);else{onPreview?.(null);onChange(patch);}setError('');}
    catch(cause){onPreview?.(null);setError(cause instanceof Error?cause.message:'The camera path could not be applied.');}
  }
  function add(){
    if(disabled||settings.keyframes.length>=8)return;
    const points=settings.keyframes;
    let index=0;for(let i=1;i<points.length-1;i++)if(points[i+1].time-points[i].time>points[index+1].time-points[index].time)index=i;
    const from=points[index],to=points[index+1];
    const point={time:(from.time+to.time)/2,scale:(from.scale+to.scale)/2,centerX:(from.centerX+to.centerX)/2,centerY:(from.centerY+to.centerY)/2,easing:to.easing};
    setSettings({...settings,keyframes:[...points.slice(0,index+1),point,...points.slice(index+1)]});setError('');
  }
  return <details className="footage-disclosure smooth-zoom-controls camera-motion-controls" aria-label="Camera glide keyframes" open={!!clip.cameraMotion}>
    <summary><span>Camera glide <small>Development</small></span><ChevronDown size={12}/></summary>
    <div className="footage-settings-section">
      <div className="camera-motion-path" role="img" aria-label={`Source target path with ${settings.keyframes.length} anchors`}><svg viewBox="0 0 200 110" aria-hidden="true"><path d={settings.keyframes.map((point,index)=>`${index?'L':'M'}${10+point.centerX*180} ${10+point.centerY*90}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5"/>{settings.keyframes.map((point,index)=><g key={index}><circle cx={10+point.centerX*180} cy={10+point.centerY*90} r="4" fill="currentColor"/><text x={10+point.centerX*180} y={5+point.centerY*90} textAnchor="middle">{index+1}</text></g>)}</svg></div>
      <NumberControl label="Glide motion blur" value={(settings.blurAmount??0)*100} min={0} max={100} step={1} unit="%" disabled={disabled} onCommit={value=>setSettings(previous=>({...previous,blurAmount:value>0?value/100:undefined}))}/>
      <p className="smooth-zoom-note">Motion blur is optional. It follows camera speed and clears when the camera holds.</p>
      <p className="smooth-zoom-note">Source targets move into the video center. Keep zoom equal to glide. Times are relative to this clip; easing controls arrival.</p>
      {!!clip.motionOffset && clip.cameraMotion && <p className="smooth-zoom-note">This segment keeps its original camera phase. Applying replaces the path within this segment.</p>}
      {settings.keyframes.map((point,index)=><fieldset key={index} className="camera-motion-point" disabled={disabled}>
        <legend><button type="button" disabled={!onSeek||disabled} onClick={()=>onSeek?.(clip.start+point.time)}>Point {index+1}</button></legend>
        <div className="smooth-zoom-timing">
          <NumberControl label={`Point ${index+1} time`} min={index?settings.keyframes[index-1].time+1/fps:0} max={index<settings.keyframes.length-1?settings.keyframes[index+1].time-1/fps:clip.duration} step={1/fps} value={point.time} unit="s" disabled={disabled} onCommit={time=>change(index,{time})}/>
          <NumberControl label={`Point ${index+1} zoom`} min={CAMERA_ZOOM_RANGE[0]} max={CAMERA_ZOOM_RANGE[1]} step={.01} value={point.scale} unit="×" disabled={disabled} onCommit={scale=>change(index,{scale})}/>
          <NumberControl label={`Point ${index+1} source X`} min={0} max={100} step={.1} value={point.centerX*100} unit="%" disabled={disabled} onCommit={value=>change(index,{centerX:value/100})}/>
          <NumberControl label={`Point ${index+1} source Y`} min={0} max={100} step={.1} value={point.centerY*100} unit="%" disabled={disabled} onCommit={value=>change(index,{centerY:value/100})}/>
        </div>
        <div className="camera-motion-point-footer"><InspectorSelect label={`Point ${index+1} arrival easing`} value={point.easing} disabled={disabled||index===0} options={SMOOTH_ZOOM_EASINGS.map(value=>({value,label:labels[value]}))} onChange={easing=>change(index,{easing})}/><button type="button" className="footage-crop" aria-label={`Remove camera point ${index+1}`} disabled={disabled||settings.keyframes.length<=2} onClick={()=>setSettings(previous=>({...previous,keyframes:previous.keyframes.filter((_,i)=>i!==index)}))}><Trash2 size={12}/></button></div>
      </fieldset>)}
      <button type="button" className="footage-crop" disabled={disabled||settings.keyframes.length>=8} onClick={add}><Plus size={12}/>Add camera point</button>
      {custom && <label className="smooth-zoom-replace"><input type="checkbox" checked={replace} disabled={disabled} onChange={event=>setReplace(event.target.checked)}/>Replace existing custom motion</label>}
      <div className="smooth-zoom-actions"><button type="button" className="footage-crop" disabled={disabled||custom&&!replace} onClick={()=>apply()}>Apply camera path</button><button type="button" className="footage-crop" disabled={disabled||custom&&!replace} onPointerDown={()=>apply(true)} onPointerUp={()=>onPreview?.(null)} onPointerCancel={()=>onPreview?.(null)} onPointerLeave={()=>onPreview?.(null)} onKeyDown={event=>{if(event.key===' '){event.preventDefault();apply(true);}}} onKeyUp={event=>{if(event.key===' ')onPreview?.(null);}} onBlur={()=>onPreview?.(null)}>Hold to preview</button>{clip.cameraMotion && <button type="button" className="footage-crop" disabled={disabled} onClick={()=>{onPreview?.(null);onChange({cameraMotion:undefined,motion:undefined,motionOffset:undefined});}}>Remove camera path</button>}</div>
      {error && <p className="smooth-zoom-error" role="alert">{error}</p>}
    </div>
  </details>;
}
