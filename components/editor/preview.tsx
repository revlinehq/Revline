'use client';
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import type { HyperframesPlayer } from '@hyperframes/player';
import { LoaderCircle } from 'lucide-react';
import { calculateVisualRect, compositionTrackIndex, generateComposition, layerZIndex } from '@/lib/editor/composition';
import { dimensions,normalizeTimeline,type Timeline,type MediaAsset,type Clip,type VisualTransform } from '@/lib/editor/types';
import { VisualHandles } from './visual-controls';
import { CropControls, type CropControlsHandle } from './crop-controls';
import { TextControls } from './text-controls';
import { useEditorState } from './editor-state';
import { previewClipAtPoint, type PreviewTextBounds } from '@/lib/editor/preview-viewport';
import { projectPreviewBounds } from '@/lib/editor/preview-zoom';
import type { SourceCrop } from '@/lib/editor/types';
function LiveTextControls(props: Omit<React.ComponentProps<typeof TextControls>, 'time'>) {
  const time=useEditorState(state=>state.playhead);
  return <TextControls {...props} time={time}/>;
}
function frameTime(player:HyperframesPlayer|null,fallback:number){const frame=player?.iframeElement?.contentWindow as (Window&{__timelines?:{revline?:{time():number}}})|null;return frame?.__timelines?.revline?.time()??player?.currentTime??fallback;}
export type PreviewHandle = { play():void; pause():void; seek(time:number):void; currentTime():number; mute(value:boolean):void; clipVolume(id:string,volume:number|null):void; resetCrop():void; finishCrop(cancel?:boolean):void };
export const Preview = forwardRef<PreviewHandle,{timeline:Timeline;assets:MediaAsset[];time:number;onTime:(time:number)=>void;onPlaying:(playing:boolean)=>void;onError:(error:string)=>void;muted:boolean;selectedClip?:Clip;onVisualChange?:(patch:Partial<Clip>)=>void;onSelectClip?:(id:string|null)=>void;onClipChange?:(id:string,patch:Partial<Clip>)=>void;onEditText?:(id:string)=>void;cropping?:boolean;onCropCommit?:(id:string,crop:SourceCrop)=>void;onCropCancel?:()=>void}>(function Preview({timeline,assets,time,onTime,onPlaying,onError,muted,selectedClip:inputSelectedClip,onVisualChange,onSelectClip,onClipChange,onEditText,cropping=false,onCropCommit,onCropCancel},ref) {
  const committedTimeline=timeline;
  timeline=normalizeTimeline(timeline);
  const selectedClip=inputSelectedClip?timeline.clips.find(clip=>clip.id===inputSelectedClip.id):undefined;
  const cropControls=useRef<CropControlsHandle>(null);
  const container=useRef<HTMLDivElement>(null); const player=useRef<HyperframesPlayer|null>(null); const callbacks=useRef({onTime,onPlaying,onError});callbacks.current={onTime,onPlaying,onError};
  const mutedRef=useRef(muted);mutedRef.current=muted;
  useEffect(()=>{if(player.current)player.current.muted=muted;},[muted]);
  const [ready,setReady]=useState(false);const [revision,setRevision]=useState(0);const seekPosition=useRef(time);
  const latestTimeline=useRef(timeline);latestTimeline.current=timeline;
  const previewVolumes=useRef(new Map<string,number>());
  // Layer order and gain update in place without rebuilding or decoding footage.
  const contentKey=JSON.stringify({timeline:{...timeline,tracks:undefined,clips:timeline.clips.map(({track,volume,...clip})=>clip)},assets:assets.map(asset=>({...asset,url:asset.url?.split('?token=')[0]??null}))});
  function updateLayers(p:HyperframesPlayer,current:Timeline){
    const doc=p.iframeElement?.contentDocument;if(!doc)return;
    current.clips.forEach((clip,index)=>{
      const node=doc.getElementById(`clip-${index}`);if(!node)return;
      node.dataset.trackIndex=String(compositionTrackIndex(clip));
      const frame=doc.getElementById(`clip-${index}-frame`);(frame??node).style.zIndex=String(layerZIndex(clip,index));
      if(clip.kind==='video'||clip.kind==='audio'){
        const volume=previewVolumes.current.get(clip.id)??clip.volume??1;
        const media=node as HTMLMediaElement;media.dataset.volume=String(volume);media.volume=volume;
        if(clip.kind==='video'){media.toggleAttribute('muted',volume===0);media.muted=volume===0||p.muted;}
      }
    });
  }
  useEffect(()=>{previewVolumes.current.clear();if(player.current)updateLayers(player.current,latestTimeline.current);},[committedTimeline]);
  useEffect(()=>()=>{player.current?.pause();player.current?.remove();player.current=null;callbacks.current.onPlaying(false);},[]);
  const [selectionVisible,setSelectionVisible]=useState(false);const selection=useRef(selectedClip);selection.current=selectedClip;
  const selectionAt=(time:number)=>{const clip=selection.current;return !!clip&&(clip.kind==='video'||clip.kind==='image')&&time>=clip.start&&time<clip.start+clip.duration;};
  useEffect(()=>setSelectionVisible(selectionAt(seekPosition.current)),[selectedClip]);
  function previewTransform(transform:VisualTransform){
    const p=player.current;const document=p?.iframeElement?.contentDocument;if(!p||!document||!selectedClip)return;
    p.pause();
    const composition=document.getElementById('composition');
    const frame=Array.from(document.querySelectorAll<HTMLElement>('[data-visual-clip]')).find(node=>node.dataset.visualClip===selectedClip.id);
    if(!composition||!frame)return;
    const width=Number(composition.dataset.width),height=Number(composition.dataset.height);
    frame.style.left=`${(transform.x-.5)*width}px`;frame.style.top=`${(transform.y-.5)*height}px`;frame.style.transform=`rotate(${transform.rotation}deg) scale(${transform.scale})`;frame.style.opacity=String(transform.opacity);
  }
  useImperativeHandle(ref,()=>({play:()=>player.current?.play(),pause:()=>player.current?.pause(),seek:(t)=>{
    seekPosition.current=t;player.current?.seek(t);setSelectionVisible(selectionAt(t));
    // HyperFrames seek lands paused without emitting a pause event.
    callbacks.current.onPlaying(false);
  },currentTime:()=>frameTime(player.current,seekPosition.current),mute:(v)=>{if(player.current)player.current.muted=v;},clipVolume:(id,volume)=>{
    if(volume===null)previewVolumes.current.delete(id);else previewVolumes.current.set(id,volume);
    if(player.current)updateLayers(player.current,latestTimeline.current);
  },resetCrop:()=>cropControls.current?.reset(),finishCrop:(cancel=false)=>{if(cancel)cropControls.current?.cancel();else cropControls.current?.done();}}),[]);
  useEffect(()=>{
    let cancelled=false,loaded=false,swapped=false;let p:HyperframesPlayer|null=null;let swapFrame=0;
    void import('@hyperframes/player').then(()=>{
      if(cancelled||!container.current)return;
      p=document.createElement('hyperframes-player') as HyperframesPlayer;
      p.muted=true;p.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:0';p.setAttribute('assets-loading-ui','none');p.setAttribute('disable-click-to-play','');p.removeAttribute('controls');
      p.setAttribute('srcdoc',generateComposition(timeline,assets,{gsapUrl:`${window.location.origin}/vendor/gsap.min.js`}));
      const swap=()=>{
        if(cancelled||!p||swapped||!loaded)return;
        // Seek and decode the replacement behind the current frame before showing it.
        p.seek(seekPosition.current);updateLayers(p,latestTimeline.current);
        swapFrame=requestAnimationFrame(()=>{swapFrame=requestAnimationFrame(()=>{
          if(cancelled||!p||swapped)return;
          swapped=true;const previous=player.current;const resume=previous&&!previous.paused;
          previous?.pause();player.current=p;p.muted=mutedRef.current;p.style.zIndex='1';previous?.remove();
          setSelectionVisible(selectionAt(seekPosition.current));callbacks.current.onTime(seekPosition.current);setReady(true);setRevision(value=>value+1);if(resume)p.play();
        });});
      };
      p.addEventListener('ready',()=>{if(cancelled||!p)return;loaded=true;p.seek(seekPosition.current);updateLayers(p,latestTimeline.current);if(p.painted)swap();});
      p.addEventListener('painted',swap);
      p.addEventListener('timeupdate',(e)=>{if(!loaded||player.current!==p)return;const detail=(e as CustomEvent<{currentTime:number}>).detail;const t=frameTime(p,detail?.currentTime??seekPosition.current);seekPosition.current=t;setSelectionVisible(selectionAt(t));callbacks.current.onTime(t);});
      const stopped=()=>{if(!loaded||player.current!==p)return;const t=frameTime(p,seekPosition.current);seekPosition.current=t;callbacks.current.onTime(t);callbacks.current.onPlaying(false);};
      p.addEventListener('play',()=>{if(loaded&&player.current===p)callbacks.current.onPlaying(true);});p.addEventListener('pause',stopped);p.addEventListener('ended',stopped);
      p.addEventListener('error',()=>{if(!cancelled)callbacks.current.onError('The preview could not load this media. Try an MP4 with H.264 video.');});
      container.current.appendChild(p);
    }).catch(e=>callbacks.current.onError(String(e)));
    // Leave the displayed player mounted until its replacement has a painted frame.
    return ()=>{cancelled=true;cancelAnimationFrame(swapFrame);if(p&&player.current!==p){p.pause();p.remove();}};
  },[contentKey]);
  const canvas=dimensions(timeline.aspectRatio);
  const asset=assets.find(asset=>asset._id===selectedClip?.assetId);
  const contentRect=selectedClip&&asset?.width&&asset?.height
    ? calculateVisualRect(asset.width,asset.height,canvas.width,canvas.height,selectedClip.crop,undefined,selectedClip.fit).window
    : {left:0,top:0,width:canvas.width,height:canvas.height};
  const cropActive=cropping&&ready&&selectedClip&&(selectedClip.kind==='image'||selectedClip.kind==='video')&&asset?.width&&asset?.height&&onCropCommit&&onCropCancel;
  return <div className={`preview-canvas aspect-${timeline.aspectRatio}`} data-testid="preview"><div ref={container} className="hyperframes-host"/>{ready&&!cropActive&&onSelectClip&&<button type="button" className="preview-hit-surface" aria-label="Select footage in preview" onClick={event=>{
    event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();
    const point=event.detail===0?{x:canvas.width/2,y:canvas.height/2}:{x:(event.clientX-rect.left)/rect.width*canvas.width,y:(event.clientY-rect.top)/rect.height*canvas.height};
    const doc=player.current?.iframeElement?.contentDocument,composition=doc?.getElementById('composition')?.getBoundingClientRect();
    const textBounds:PreviewTextBounds[]=composition?.width&&composition.height?timeline.clips.flatMap((clip,index)=>{
      if(clip.kind!=='caption'&&clip.kind!=='graphic')return [];
      const node=doc?.getElementById(`clip-${index}`);return node?[{id:clip.id,rect:projectPreviewBounds(node.getBoundingClientRect(),composition,canvas)}]:[];
    }):[];
    const hit=previewClipAtPoint(timeline,assets,frameTime(player.current,seekPosition.current),point,textBounds);
    player.current?.pause();onSelectClip(hit?.id??null);
  }} onKeyDown={event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();}}/>}{ready&&!cropActive&&selectionVisible&&selectedClip&&onVisualChange&&<div style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:layerZIndex(selectedClip,timeline.clips.findIndex(clip=>clip.id===selectedClip.id))}}><VisualHandles key={selectedClip.id} clip={selectedClip} canvas={canvas} contentRect={contentRect} onPreview={previewTransform} onCommit={transform=>onVisualChange({transform})}/></div>} {ready&&!cropActive&&onSelectClip&&onClipChange&&<LiveTextControls timeline={timeline} assets={assets} revision={revision} selected={selectedClip?.id} getDocument={()=>player.current?.iframeElement?.contentDocument??null} onSelect={onSelectClip} onCommit={onClipChange} onEdit={onEditText} onPause={()=>player.current?.pause()}/>}
    {cropActive&&<CropControls key={selectedClip.id} ref={cropControls} initial={selectedClip.crop} sourceSize={{width:asset.width!,height:asset.height!}} canvas={canvas} revision={revision} getSource={()=>{
      const doc=player.current?.iframeElement?.contentDocument;
      const frame=Array.from(doc?.querySelectorAll<HTMLElement>('[data-visual-clip]')??[]).find(node=>node.dataset.visualClip===selectedClip.id);
      return frame?.querySelector<HTMLImageElement|HTMLVideoElement>('img,video')??null;
    }} onCommit={crop=>onCropCommit(selectedClip.id,crop)} onCancel={onCropCancel}/>}
    {!ready&&<div className="preview-loading"><LoaderCircle className="animate-spin" size={20}/></div>}</div>;
});
