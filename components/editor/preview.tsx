'use client';
import { userError } from '@/lib/user-error';
// @refresh reset
import { previewVisualFade } from '@/lib/editor/visual-fades-runtime';
import { warmPreviewMedia } from '@/lib/editor/preview-media-warmup';
import { waitForPreviewMedia } from '@/lib/editor/preview-readiness';
import { guardPreviewBuffering } from '@/lib/editor/preview-buffering';
import { useEffect, useLayoutEffect, useRef, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { audioFadeAttributes, audioVolumeEnvelope } from '@/lib/editor/audio-settings';
import type { HyperframesPlayer } from '@hyperframes/player';
import { LoaderCircle } from 'lucide-react';
import { calculateVisualRect, compositionTrackIndex, generateComposition, layerZIndex } from '@/lib/editor/composition';
import { dimensions,normalizeTimeline,type Timeline,type MediaAsset,type Clip,type VisualTransform } from '@/lib/editor/types';
import { VisualHandles } from './visual-controls';
import { CropControls, type CropControlsHandle } from './crop-controls';
import { TextControls } from './text-controls';
import { useEditorState, usePausedPlaybackTime } from './editor-state';
import { previewClipAtPoint, previewMediaOpacities, type PreviewTextBounds } from '@/lib/editor/preview-viewport';
import { projectPreviewBounds } from '@/lib/editor/preview-zoom';
import type { SourceCrop } from '@/lib/editor/types';
import { previewContentKey } from '@/lib/editor/preview-content-key';
import { compositionNode, compositionIndex } from '@/lib/editor/composition-node';
import { needsLiveMediaSync, updateLiveMediaContent } from '@/lib/editor/live-media-content';
import { updateLiveTextEffects } from '@/lib/editor/live-preview-effects';
import { previewVisualEffects, updateLiveVisualEffects } from '@/lib/editor/live-visual-effects';
import { updateLiveVisualGeometry } from '@/lib/editor/live-visual-geometry';
import { recoverMediaSource, type RefreshPlaybackMedia } from '@/lib/editor/media-source-recovery';
import { sourceTimeAt } from '@/lib/editor/playback-rate';
import { previewAdjustmentEffect, updateLiveAdjustmentEffects } from '@/lib/editor/live-adjustment-effects';
import { loadPreviewRemotion } from '@/lib/editor/preview-remotion-runtime';
function LiveTextControls(props: Omit<React.ComponentProps<typeof TextControls>, 'time'>) {
  const time=usePausedPlaybackTime(),playing=useEditorState(state=>state.playing);
  if(playing)return null;
  return <TextControls {...props} time={time}/>;
}
function frameTime(player:HyperframesPlayer|null,fallback:number){const frame=player?.iframeElement?.contentWindow as (Window&{__timelines?:{revline?:{time():number}}})|null;return frame?.__timelines?.revline?.time()??player?.currentTime??fallback;}
export type PreviewHandle = { play():void; pause():void; seek(time:number):void; currentTime():number; mute(value:boolean):void; clipVolume(id:string,volume:number|null):void; clipEffects(id:string,patch:Partial<Clip>|null):void; resetCrop():void; finishCrop(cancel?:boolean):void; retry():void };
export const Preview = forwardRef<PreviewHandle,{timeline:Timeline;assets:MediaAsset[];time:number;onTime:(time:number)=>void;onPlaying:(playing:boolean)=>void;onError:(error:string)=>void;muted:boolean;selectedClip?:Clip;onRefreshMedia?:RefreshPlaybackMedia;onVisualChange?:(patch:Partial<Clip>)=>void;onSelectClip?:(id:string|null)=>void;onClipChange?:(id:string,patch:Partial<Clip>)=>void;onEditText?:(id:string)=>void;onEditClip?:(id:string)=>void;cropping?:boolean;onCropCommit?:(id:string,crop:SourceCrop)=>void;onCropCancel?:()=>void;debugId?:string;onReady?:()=>void;onThumbnail?:(url:string)=>void}>(function Preview({timeline,assets,time,onTime,onPlaying,onError,muted,selectedClip:inputSelectedClip,onRefreshMedia,onVisualChange,onSelectClip,onClipChange,onEditText,onEditClip,cropping=false,onCropCommit,onCropCancel,debugId,onReady,onThumbnail},ref) {
  const committedTimeline=timeline;
  timeline=normalizeTimeline(timeline);
  const selectedClip=inputSelectedClip?timeline.clips.find(clip=>clip.id===inputSelectedClip.id):undefined;
  const cropControls=useRef<CropControlsHandle>(null);
  const container=useRef<HTMLDivElement>(null); const player=useRef<HyperframesPlayer|null>(null); const callbacks=useRef({onTime,onPlaying,onError,onRefreshMedia,onReady,onThumbnail});callbacks.current={onTime,onPlaying,onError,onRefreshMedia,onReady,onThumbnail};
  const playbackGuard=useRef<ReturnType<typeof guardPreviewBuffering>|null>(null);
  const diagnostic=useRef<(reason:string)=>void>(()=>{});
  const latestAssets=useRef(assets);latestAssets.current=assets;
  const refreshedSources=useRef(new Map<string,{original:string|null;url:string}>());
  const mutedRef=useRef(muted);mutedRef.current=muted;
  useEffect(()=>{if(player.current)player.current.muted=muted;},[muted]);
  const [ready,setReady]=useState(false);const [revision,setRevision]=useState(0);const [reloadRevision,setReloadRevision]=useState(0);const seekPosition=useRef(time);
  const latestTimeline=useRef(timeline);latestTimeline.current=timeline;
  const renderedTimeline=useRef<Timeline|null>(null);
  const renderedContentKey=useRef<string|null>(null);
  const clipIndex=useRef(new Map<string,{clip:Clip;index:number}>());
  clipIndex.current=useMemo(()=>new Map(timeline.clips.map((clip,index)=>[clip.id,{clip,index}])),[timeline.clips]);
  const previewVolumes=useRef(new Map<string,number>());
  // Layer order and gain update in place without rebuilding or decoding footage.
  const contentKey=useMemo(()=>previewContentKey(timeline,assets),[timeline,assets]);
  function updateClip(p:HyperframesPlayer,clip:Clip,index:number,current:Timeline=latestTimeline.current){
    if(clip.kind==='effect')return;
    const doc=p.iframeElement?.contentDocument;if(!doc)return;
    const node=compositionNode(doc,clip,index);if(!node)return;index=compositionIndex(doc,clip,index);
    const trackIndex=String(compositionTrackIndex(clip));if(node.dataset.trackIndex!==trackIndex)node.dataset.trackIndex=trackIndex;
    const frame=clip.kind==='video'||clip.kind==='image'?doc.getElementById(`clip-${index}-frame`):null,visual=frame??node,zIndex=String(layerZIndex(clip,index));if(visual.style.zIndex!==zIndex)visual.style.zIndex=zIndex;
    if(clip.kind==='video'||clip.kind==='audio'){
      const volume=previewVolumes.current.get(clip.id)??clip.volume??1;
      const media=node as HTMLMediaElement;if(media.dataset.volume!==String(volume))media.dataset.volume=String(volume);
      // Compare the complete lane: other voice clips can change music gain without changing this clip's volume.
      const automation=audioVolumeEnvelope(current,clip,volume),fades=audioFadeAttributes(clip);
      if(media.dataset.automation!==automation)media.dataset.automation=automation;
      if(media.dataset.fadeIn!==String(fades.fadeIn))media.dataset.fadeIn=String(fades.fadeIn);
      if(media.dataset.fadeOut!==String(fades.fadeOut))media.dataset.fadeOut=String(fades.fadeOut);
      media.volume=Math.min(1,volume);
      if(clip.kind==='video'){media.toggleAttribute('muted',volume===0);media.muted=volume===0||p.muted;}
    }
  }
  function updateLayers(p:HyperframesPlayer,current:Timeline){
    const effective=previewVolumes.current.size?{...current,clips:current.clips.map(clip=>previewVolumes.current.has(clip.id)?{...clip,volume:previewVolumes.current.get(clip.id)}:clip)}:current;
    effective.clips.forEach((clip,index)=>updateClip(p,clip,index,effective));
  }
  useLayoutEffect(()=>{
    previewVolumes.current.clear();
    const active=player.current,current=latestTimeline.current,previous=renderedTimeline.current;
    const doc=active?.iframeElement?.contentDocument;
    if(!active||!doc||!previous)return;
    if(renderedContentKey.current!==contentKey)return;
    let cancelled=false;
    const apply=()=>{if(cancelled||player.current!==active||active.iframeElement?.contentDocument!==doc)return;try{
      const retained=updateLiveMediaContent(doc,previous,current,assets)&&updateLiveAdjustmentEffects(doc,previous,current)&&updateLiveTextEffects(doc,previous,current)&&updateLiveVisualEffects(doc,previous,current)&&updateLiveVisualGeometry(doc,previous,current,assets);
      if(retained){
        updateLayers(active,current);
        if(needsLiveMediaSync(previous,current)){
          const wasPlaying=!active.paused;
          active.seek(frameTime(active,seekPosition.current));
          if(wasPlaying)active.play();
        }
        renderedTimeline.current=current;setRevision(value=>value+1);
      }
      else setReloadRevision(value=>value+1);
    }catch(error){callbacks.current.onError(userError(error, 'Could not apply this preview edit.'));}};
    const optional=loadPreviewRemotion(doc,current);
    if(optional)void optional.then(apply,error=>{if(!cancelled)callbacks.current.onError(userError(error, 'Could not load the preview renderer.'));});else apply();
    return()=>{cancelled=true;};
  },[committedTimeline,assets,contentKey]);
  useEffect(()=>()=>{playbackGuard.current?.dispose();playbackGuard.current=null;player.current?.pause();player.current?.remove();player.current=null;callbacks.current.onPlaying(false);},[]);
  const [transformId,setTransformId]=useState<string|null>(null);
  useEffect(()=>{setTransformId(current=>cropping||current!==selectedClip?.id?null:current);},[selectedClip?.id,cropping]);
  const [selectionVisible,setSelectionVisible]=useState(false);const selection=useRef(selectedClip);selection.current=selectedClip;
  const selectionAt=(time:number)=>{const clip=selection.current;return !!clip&&(clip.kind==='video'||clip.kind==='image')&&time>=clip.start&&time<clip.start+clip.duration;};
  useEffect(()=>setSelectionVisible(selectionAt(seekPosition.current)),[selectedClip]);
  function previewTransform(transform:VisualTransform){
    const p=player.current;const document=p?.iframeElement?.contentDocument;if(!p||!document||!selectedClip)return;
    const composition=document.getElementById('composition');
    const frame=Array.from(document.querySelectorAll<HTMLElement>('[data-visual-clip]')).find(node=>node.dataset.visualClip===selectedClip.id);
    if(!composition||!frame)return;
    const width=Number(composition.dataset.width),height=Number(composition.dataset.height);
    frame.style.left=`${(transform.x-.5)*width}px`;frame.style.top=`${(transform.y-.5)*height}px`;frame.style.transform=`rotate(${transform.rotation}deg) scale(${transform.scale})`;frame.style.opacity=String(transform.opacity);
  }
  useImperativeHandle(ref,()=>({retry:()=>setReloadRevision(value=>value+1),play:()=>{if(playbackGuard.current)playbackGuard.current.play();else player.current?.play();},pause:()=>{if(playbackGuard.current)playbackGuard.current.pause();else player.current?.pause();callbacks.current.onPlaying(false);},seek:(t)=>{
    playbackGuard.current?.cancel();seekPosition.current=t;player.current?.seek(t);setSelectionVisible(selectionAt(t));
    // HyperFrames seek lands paused without emitting a pause event.
    callbacks.current.onPlaying(false);
  },currentTime:()=>frameTime(player.current,seekPosition.current),mute:(v)=>{if(player.current)player.current.muted=v;},clipVolume:(id,volume)=>{
    if(volume===null)previewVolumes.current.delete(id);else previewVolumes.current.set(id,volume);
    if(player.current)updateLayers(player.current,latestTimeline.current);
  },clipEffects:(id,patch)=>{
    const entry=clipIndex.current.get(id),doc=player.current?.iframeElement?.contentDocument;
    if(entry&&doc)try{
      if(entry.clip.kind==='effect'||entry.clip.kind==='solid')previewAdjustmentEffect(doc,entry.clip,compositionIndex(doc,entry.clip,entry.index),patch);
      else if(entry.clip.kind==='caption'||entry.clip.kind==='graphic'){
        const before=latestTimeline.current;
        updateLiveTextEffects(doc,before,{...before,clips:before.clips.map(clip=>clip.id===id?{...clip,...patch}:clip)});
      }else if(entry.clip.kind==='audio'){
        if(patch?.volume!==undefined)previewVolumes.current.set(id,patch.volume);else previewVolumes.current.delete(id);
        const before=latestTimeline.current;
        if(player.current)updateLayers(player.current,{...before,clips:before.clips.map(clip=>clip.id===id?{...clip,...patch}:clip)});
      }else{
        previewVisualEffects(doc,entry.clip,compositionIndex(doc,entry.clip,entry.index),patch);
        previewVisualFade(doc,entry.clip,patch);
        if(entry.clip.kind==='video'||entry.clip.kind==='image'){
          const transform={x:.5,y:.5,scale:1,rotation:0,opacity:1,...entry.clip.transform,...patch?.transform};
          const frame=Array.from(doc.querySelectorAll<HTMLElement>('[data-visual-clip]')).find(node=>node.dataset.visualClip===id);
          if(frame)frame.style.opacity=String(transform.opacity);
        }
      }
    }catch(error){callbacks.current.onError(userError(error, 'Could not preview this effect.'));}
  },resetCrop:()=>cropControls.current?.reset(),finishCrop:(cancel=false)=>{if(cancel)cropControls.current?.cancel();else cropControls.current?.done();}}),[]);
  useEffect(()=>{
    let cancelled=false,loaded=false,swapped=false,waitingForMedia=false;let p:HyperframesPlayer|null=null;let swapFrame=0;let guard:ReturnType<typeof guardPreviewBuffering>|undefined;
    let diagnosticTimer:ReturnType<typeof setTimeout>|undefined;
    const diagnose=(reason:string)=>{
      if(!p||!debugId)return;
      const doc=p.iframeElement?.contentDocument,win=doc?.defaultView as (Window&{__renderReady?:boolean;__player?:unknown;__timelines?:{revline?:{time():number;paused():boolean;duration():number}};gsap?:{ticker:{time:number}}})|null;
      const media=Array.from(doc?.querySelectorAll<HTMLMediaElement>('video,audio')??[]);
      console.warn('[Revline playback]',JSON.stringify({chatId:debugId,reason,ready:p.ready,painted:p.painted,time:p.currentTime,paused:p.paused,renderReady:win?.__renderReady,hasRuntime:!!win?.__player,clock:frameTime(p,seekPosition.current),clockPaused:win?.__timelines?.revline?.paused(),duration:win?.__timelines?.revline?.duration(),tickerTime:win?.gsap?.ticker.time,runtimeSrc:p.getAttribute('runtime-src'),scripts:Array.from(doc?.scripts??[],node=>node.src).filter(Boolean).map(url=>url.split('?')[0]),mediaCount:media.length,readyCount:media.filter(node=>node.readyState>=2).length,active:media.filter(node=>seekPosition.current>=Number(node.dataset.start)&&seekPosition.current<Number(node.dataset.end)).map(node=>({id:node.dataset.sourceClip,readyState:node.readyState,error:node.error?.code??null,paused:node.paused,sourceTime:node.currentTime}))}));
    };
    diagnostic.current=diagnose;
    const iframeError=(event:MessageEvent)=>{if(cancelled||event.source!==p?.iframeElement?.contentWindow||event.origin!==window.location.origin||event.data?.source!=='revline-preview-error')return;console.error(`[Revline preview error] ${event.data.label}: ${event.data.message}`,{chatId:debugId});callbacks.current.onError(`Preview: ${event.data.message}`);};
    window.addEventListener('message',iframeError);
    const recovery=new AbortController(),attempted=new WeakSet<HTMLMediaElement>(),refreshes=new Map<string,Promise<string|null>>();let removeMediaErrors:(()=>void)|undefined, stopWarmup:(()=>void)|undefined;
    void import('@hyperframes/player').then(()=>{
      if(cancelled||!container.current)return;
      p=document.createElement('hyperframes-player') as HyperframesPlayer;
      p.muted=true;p.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:0';p.setAttribute('assets-loading-ui','none');p.setAttribute('runtime-src',`${window.location.origin}/vendor/hyperframe.runtime.iife.js`);p.setAttribute('disable-click-to-play','');p.removeAttribute('controls');
      const recoveredUrls=Object.fromEntries(assets.flatMap(asset=>{const refreshed=refreshedSources.current.get(asset._id);return refreshed&&refreshed.original===asset.url?[[asset._id,refreshed.url]]:[];}));
      p.setAttribute('srcdoc',generateComposition(timeline,assets,{preview:true,assetUrls:recoveredUrls,gsapUrl:`${window.location.origin}/vendor/gsap.min.js`,visualEffectsUrl:`${window.location.origin}/vendor/visual-effects.js?v=solid-layers-10`,remotionRuntimeUrl:`${window.location.origin}/vendor/remotion-runtime.js?v=shared-scenes-1`}));
      const swap=()=>{
        if(cancelled||!p||swapped||!loaded||waitingForMedia)return;
        waitingForMedia=true;
        // Seek and decode the replacement behind the current frame before showing it.
        p.seek(seekPosition.current);updateLayers(p,latestTimeline.current);
        const doc=p.iframeElement?.contentDocument;
        if(!doc)return;
        void waitForPreviewMedia(doc,seekPosition.current,recovery.signal,callbacks.current.onThumbnail).then(()=>{swapFrame=requestAnimationFrame(()=>{swapFrame=requestAnimationFrame(()=>{
          if(cancelled||!p||swapped)return;
          swapped=true;const previous=player.current;const resume=playbackGuard.current?.isPlaying()??(previous&&!previous.paused);
          if(p.iframeElement?.contentDocument){updateLiveMediaContent(p.iframeElement.contentDocument,timeline,latestTimeline.current,latestAssets.current);updateLiveTextEffects(p.iframeElement.contentDocument,timeline,latestTimeline.current);updateLiveVisualEffects(p.iframeElement.contentDocument,timeline,latestTimeline.current);updateLiveVisualGeometry(p.iframeElement.contentDocument,timeline,latestTimeline.current,assets);updateLiveAdjustmentEffects(p.iframeElement.contentDocument,timeline,latestTimeline.current);}
          playbackGuard.current?.dispose();previous?.pause();player.current=p;playbackGuard.current=guard??null;p.muted=mutedRef.current;p.style.zIndex='1';previous?.remove();
          renderedTimeline.current=latestTimeline.current;
          renderedContentKey.current=contentKey;
          setSelectionVisible(selectionAt(seekPosition.current));callbacks.current.onTime(seekPosition.current);setReady(true);callbacks.current.onReady?.();setRevision(value=>value+1);if(resume){if(guard)guard.play();else p.play();}
        });});}).catch(error=>{if(!cancelled&&!recovery.signal.aborted)callbacks.current.onError(userError(error, 'The footage could not load.'));});
      };
      p.addEventListener('ready',()=>{if(cancelled||!p)return;
        const doc=p.iframeElement?.contentDocument;
        const mediaError=(event:Event)=>{
          const media=event.target as HTMLMediaElement;
          if(cancelled||player.current!==p||!doc||!media||!['VIDEO','AUDIO'].includes(media.tagName)||attempted.has(media))return;
          const sourceClip=latestTimeline.current.clips.find(clip=>clip.id===media.dataset.sourceClip);
          if(!sourceClip?.assetId)return;
          attempted.add(media);
          const assetId=sourceClip.assetId;
          void (async()=>{
            let url=refreshes.get(assetId);
            if(!url){
              const refresh=callbacks.current.onRefreshMedia;
              url=refresh?refresh([assetId]).then(patches=>patches.find(asset=>asset._id===assetId)?.url??null):Promise.resolve(latestAssets.current.find(asset=>asset._id===assetId)?.url??null);
              refreshes.set(assetId,url);void url.finally(()=>refreshes.delete(assetId)).catch(()=>{});
            }
            const fresh=await url;
            if(cancelled)return;
            if(!fresh)throw new Error('No playable source URL.');
            // A later cut rebuilds the composition; retain its recovered URL
            // until reactive source props supply a different URL themselves.
            refreshedSources.current.set(assetId,{original:latestAssets.current.find(asset=>asset._id===assetId)?.url??null,url:fresh});
            await recoverMediaSource(media,fresh,{signal:recovery.signal,position:()=>sourceTimeAt(latestTimeline.current.clips.find(clip=>clip.id===media.dataset.sourceClip)??sourceClip,frameTime(p,seekPosition.current)),playing:()=>{
              const current=latestTimeline.current.clips.find(clip=>clip.id===media.dataset.sourceClip),time=frameTime(p,seekPosition.current);
              return !!p&&!p.paused&&!!current&&time>=current.start&&time<current.start+current.duration;
            },redraw:()=>{const host=doc.defaultView as (Window&{__revlineEffects?:{redraw():void}})|null;host?.__revlineEffects?.redraw();}});
            attempted.delete(media);
          })().catch(error=>{
            if(cancelled||recovery.signal.aborted)return;
            if(error&&typeof error==='object'&&'name' in error&&error.name==='NotAllowedError'){p?.pause();callbacks.current.onPlaying(false);callbacks.current.onError('The media has recovered. Press play to resume.');}
            else callbacks.current.onError('This source is unavailable. Reimport the clip or reload the project.');
          });
        };
        doc?.addEventListener('error',mediaError,true);removeMediaErrors=()=>doc?.removeEventListener('error',mediaError,true);
        doc?.defaultView?.addEventListener('revline-effects-error',event=>{if(!cancelled)callbacks.current.onError((event as CustomEvent<string>).detail);});
        if(doc?.documentElement.dataset.visualEffectsError)callbacks.current.onError(doc.documentElement.dataset.visualEffectsError);
        loaded=true;if(doc){stopWarmup=warmPreviewMedia(doc,()=>frameTime(p,seekPosition.current));guard=guardPreviewBuffering(doc,p,()=>frameTime(p,seekPosition.current));}p.seek(seekPosition.current);updateLayers(p,latestTimeline.current);if(p.painted)swap();});
      p.addEventListener('painted',swap);
      p.addEventListener('timeupdate',(e)=>{if(!loaded||player.current!==p)return;const detail=(e as CustomEvent<{currentTime:number}>).detail;const t=frameTime(p,detail?.currentTime??seekPosition.current);seekPosition.current=t;setSelectionVisible(selectionAt(t));callbacks.current.onTime(t);});
      const stopped=()=>{if(!loaded||player.current!==p)return;const t=frameTime(p,seekPosition.current);seekPosition.current=t;callbacks.current.onTime(t);if(!guard?.isBuffering())callbacks.current.onPlaying(false);};
      p.addEventListener('play',()=>{if(p&&loaded&&player.current===p){callbacks.current.onPlaying(true);const start=p.currentTime;if(diagnosticTimer)clearTimeout(diagnosticTimer);diagnosticTimer=setTimeout(()=>{if(p&&!p.paused&&p.currentTime<=start+.05)diagnose('clock did not advance after Play');},1200);}});p.addEventListener('pause',stopped);p.addEventListener('ended',stopped);
      p.addEventListener('error',()=>{if(!cancelled){diagnose('player error');callbacks.current.onError('The preview could not load this media. Try an MP4 with H.264 video.');}});
      container.current.appendChild(p);if(debugId)diagnosticTimer=setTimeout(()=>{if(p&&!p.ready)diagnose('player readiness stalled');},4000);
    }).catch(e=>callbacks.current.onError(String(e)));
    // Leave the displayed player mounted until its replacement has a painted frame.
    return ()=>{cancelled=true;window.removeEventListener('message',iframeError);if(diagnosticTimer)clearTimeout(diagnosticTimer);recovery.abort();removeMediaErrors?.();stopWarmup?.();cancelAnimationFrame(swapFrame);if(p&&player.current!==p){guard?.dispose();p.pause();p.remove();}};
  },[contentKey,reloadRevision]);
  const canvas=dimensions(timeline.aspectRatio);
  const asset=assets.find(asset=>asset._id===selectedClip?.assetId);
  const contentRect=selectedClip&&asset?.width&&asset?.height
    ? calculateVisualRect(asset.width,asset.height,canvas.width,canvas.height,selectedClip.crop,undefined,selectedClip.fit).window
    : {left:0,top:0,width:canvas.width,height:canvas.height};
  const cropActive=cropping&&ready&&selectedClip&&(selectedClip.kind==='image'||selectedClip.kind==='video')&&asset?.width&&asset?.height&&onCropCommit&&onCropCancel;
  return <div className={`preview-canvas aspect-${timeline.aspectRatio}`} data-testid="preview"><div ref={container} className="hyperframes-host"/>{ready&&!cropActive&&onSelectClip&&<button type="button" className="preview-hit-surface" aria-label="Select footage in preview" title="Double-click for Clip settings · Alt-click to select overlapping layers" onClick={event=>{
    event.stopPropagation();const rect=event.currentTarget.getBoundingClientRect();
    const point=event.detail===0?{x:canvas.width/2,y:canvas.height/2}:{x:(event.clientX-rect.left)/rect.width*canvas.width,y:(event.clientY-rect.top)/rect.height*canvas.height};
    const doc=player.current?.iframeElement?.contentDocument,composition=doc?.getElementById('composition')?.getBoundingClientRect();
    const textBounds:PreviewTextBounds[]=composition?.width&&composition.height?timeline.clips.flatMap((clip,index)=>{
      if(clip.kind!=='caption'&&clip.kind!=='graphic')return [];
      const node=doc?compositionNode(doc,clip,index):null;return node?[{id:clip.id,rect:projectPreviewBounds(node.getBoundingClientRect(),composition,canvas)}]:[];
    }):[];
    const hit=previewClipAtPoint(timeline,assets,frameTime(player.current,seekPosition.current),point,textBounds,{mediaOpacities:doc?previewMediaOpacities(doc):undefined,cycleAfter:event.altKey?selectedClip?.id??null:undefined});
    if(event.detail===2||event.detail===0)setTransformId(hit?.id??null);
    else if(hit?.id!==selectedClip?.id)setTransformId(null);
    onSelectClip(hit?.id??null);
    if(event.detail===2&&(hit?.kind==='video'||hit?.kind==='image'))onEditClip?.(hit.id);
  }} onKeyDown={event=>{if(event.key===' '||event.key==='Enter')event.stopPropagation();}}/>}{ready&&!cropActive&&selectionVisible&&selectedClip&&transformId===selectedClip.id&&onVisualChange&&<div style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:layerZIndex(selectedClip,timeline.clips.findIndex(clip=>clip.id===selectedClip.id))}}><VisualHandles key={selectedClip.id} clip={selectedClip} canvas={canvas} contentRect={contentRect} onPreview={previewTransform} onEdit={()=>onEditClip?.(selectedClip.id)} onCommit={transform=>onVisualChange({transform})}/></div>} {ready&&!cropActive&&onSelectClip&&onClipChange&&<LiveTextControls timeline={timeline} assets={assets} revision={revision} selected={selectedClip?.id} activeId={transformId??undefined} onActivate={id=>{setTransformId(id);const clip=timeline.clips.find(clip=>clip.id===id);if(clip?.kind==='video'||clip?.kind==='image')onEditClip?.(id);}} getDocument={()=>player.current?.iframeElement?.contentDocument??null} onSelect={onSelectClip} onCommit={onClipChange} onEdit={onEditText}/>}
    {cropActive&&<CropControls key={selectedClip.id} ref={cropControls} initial={selectedClip.crop} sourceSize={{width:asset.width!,height:asset.height!}} canvas={canvas} revision={revision} getSource={()=>{
      const doc=player.current?.iframeElement?.contentDocument;
      const frame=Array.from(doc?.querySelectorAll<HTMLElement>('[data-visual-clip]')??[]).find(node=>node.dataset.visualClip===selectedClip.id);
      return frame?.querySelector<HTMLImageElement|HTMLVideoElement>('img,video')??null;
    }} onCommit={crop=>onCropCommit(selectedClip.id,crop)} onCancel={onCropCancel}/>}
    {!ready&&<div className="preview-loading"><LoaderCircle className="animate-spin" size={20}/></div>}</div>;
});
