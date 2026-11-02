'use client';
import { SafeAreaOverlay } from './safe-area-overlay';
import type { SafeAreaPlatform } from '@/lib/editor/safe-areas';
import { userError } from '@/lib/user-error';
// @refresh reset
import { previewVisualFade } from '@/lib/editor/visual-fades-runtime';
import { createPreviewMediaSession } from '@/lib/editor/preview-media-session';
import { createPreviewSourceCache, MAX_PREVIEW_BYTES } from '@/lib/editor/preview-source-cache';
import { tracePreviewPlayback } from '@/lib/editor/preview-diagnostics';
import { useEffect, useLayoutEffect, useRef, useState, useMemo, forwardRef, useImperativeHandle } from 'react';
import { resolvedAudioTimeline } from '@/lib/editor/audio-normalization';
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
import { updateLiveScenes } from '@/lib/editor/live-scenes';
import { previewVisualEffects, updateLiveVisualEffects } from '@/lib/editor/live-visual-effects';
import { updateLiveVisualGeometry } from '@/lib/editor/live-visual-geometry';
import type { RefreshPlaybackMedia } from '@/lib/editor/media-source-recovery';
import { previewAdjustmentEffect, updateLiveAdjustmentEffects } from '@/lib/editor/live-adjustment-effects';
import { loadPreviewRemotion } from '@/lib/editor/preview-remotion-runtime';import { sceneMediaAssetIds } from '@/lib/editor/scene-layers';
/** Assets the preview must load: every clip's media plus images and videos shown inside scenes. */
const usedAssetIds=(timeline:Timeline)=>new Set<string|undefined>([...timeline.clips.map(clip=>clip.assetId),...sceneMediaAssetIds(timeline)]);

function LiveTextControls(props: Omit<React.ComponentProps<typeof TextControls>, 'time'>) {
  const time=usePausedPlaybackTime(),playing=useEditorState(state=>state.playing);
  if(playing)return null;
  return <TextControls {...props} time={time}/>;
}
// A cold preview download can take seconds. Opening waits briefly for the
// local copy, then starts on byte-range playback; the live-update path swaps
// the local copy in once its shared download finishes.
const LOCAL_COPY_WAIT_MS=1200;
function openingAssets(cache:ReturnType<typeof createPreviewSourceCache>,assets:MediaAsset[],signal:AbortSignal):Promise<MediaAsset[]>{
  const local=cache.prepare(assets,signal);void local.catch(()=>{});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const fallback=new Promise<MediaAsset[]>(resolve=>{timer=setTimeout(()=>resolve(cache.cachedAssets(assets)),LOCAL_COPY_WAIT_MS);});
  return Promise.race([local,fallback]).finally(()=>clearTimeout(timer));
}
function frameTime(player:HyperframesPlayer|null,fallback:number){const frame=player?.iframeElement?.contentWindow as (Window&{__timelines?:{revline?:{time():number}}})|null;return frame?.__timelines?.revline?.time()??player?.currentTime??fallback;}
export type PreviewHandle = { play():void; pause():void; seek(time:number):void; currentTime():number; mute(value:boolean):void; clipVolume(id:string,volume:number|null):void; clipEffects(id:string,patch:Partial<Clip>|null):void; resetCrop():void; finishCrop(cancel?:boolean):void; retry():void };
export const Preview = forwardRef<PreviewHandle,{/** Platform UI overlay for vertical frames. */safeArea?:SafeAreaPlatform|null;timeline:Timeline;assets:MediaAsset[];time:number;onTime:(time:number)=>void;onPlaying:(playing:boolean)=>void;onError:(error:string)=>void;muted:boolean;selectedClip?:Clip;onRefreshMedia?:RefreshPlaybackMedia;onPlaybackAssets?:(assets:MediaAsset[])=>void;onVisualChange?:(patch:Partial<Clip>)=>void;onSelectClip?:(id:string|null)=>void;onClipChange?:(id:string,patch:Partial<Clip>)=>void;onEditText?:(id:string)=>void;onEditClip?:(id:string)=>void;cropping?:boolean;onCropCommit?:(id:string,crop:SourceCrop)=>void;onCropCancel?:()=>void;debugId?:string;onReady?:()=>void;onThumbnail?:(url:string)=>void;onSlowLoad?:()=>void}>(function Preview({safeArea,timeline,assets,time,onTime,onPlaying,onError,muted,selectedClip:inputSelectedClip,onRefreshMedia,onPlaybackAssets,onVisualChange,onSelectClip,onClipChange,onEditText,onEditClip,cropping=false,onCropCommit,onCropCancel,debugId,onReady,onThumbnail,onSlowLoad},ref) {
  const committedTimeline=timeline;
  timeline=useMemo(()=>resolvedAudioTimeline(normalizeTimeline(committedTimeline)),[committedTimeline]);
  const selectedClip=inputSelectedClip?timeline.clips.find(clip=>clip.id===inputSelectedClip.id):undefined;
  const cropControls=useRef<CropControlsHandle>(null);
  const container=useRef<HTMLDivElement>(null); const player=useRef<HyperframesPlayer|null>(null); const callbacks=useRef({onTime,onPlaying,onError,onRefreshMedia,onPlaybackAssets,onReady,onThumbnail,onSlowLoad});callbacks.current={onTime,onPlaying,onError,onRefreshMedia,onPlaybackAssets,onReady,onThumbnail,onSlowLoad};
  const mediaSession=useRef<ReturnType<typeof createPreviewMediaSession>|null>(null);
  const sourceCache=useRef<ReturnType<typeof createPreviewSourceCache>|null>(null);
  const disposeDisplayed=useRef<(()=>void)|null>(null);
  const renderedAssets=useRef<MediaAsset[]>([]);
  useEffect(()=>{
    const cache=createPreviewSourceCache();sourceCache.current=cache;
    return()=>{disposeDisplayed.current?.();disposeDisplayed.current=null;mediaSession.current=null;player.current=null;cache.dispose();if(sourceCache.current===cache)sourceCache.current=null;};
  },[]);
  const diagnostic=useRef<(reason:string)=>void>(()=>{});
  const latestAssets=useRef(assets);latestAssets.current=assets;
  const mutedRef=useRef(muted);mutedRef.current=muted;
  useEffect(()=>{if(player.current)player.current.muted=muted;},[muted]);
  const [buffering,setBuffering]=useState(false);const [ready,setReady]=useState(false);const [revision,setRevision]=useState(0);const [reloadRevision,setReloadRevision]=useState(0);const [playerVersion,setPlayerVersion]=useState(0);const seekPosition=useRef(time);const seekRequest=useRef(0);const seekOwned=useRef(false);
  // An unsettled seek leaves the runtime reporting its last settled time, so a
  // paused seek owns the preview clock until playback starts again.
  const playbackTime=(p:HyperframesPlayer|null)=>seekOwned.current&&(p?.paused??true)?seekPosition.current:frameTime(p,seekPosition.current);
  const latestTimeline=useRef(timeline);latestTimeline.current=timeline;
  const latestCommittedTimeline=useRef(committedTimeline);latestCommittedTimeline.current=committedTimeline;
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
    const doc=active?.iframeElement?.contentDocument,cache=sourceCache.current;
    if(!active||!doc||!previous||!cache||renderedContentKey.current!==contentKey)return;
    const controller=new AbortController();let cancelled=false;
    const apply=(playbackAssets:MediaAsset[])=>{if(cancelled||player.current!==active||active.iframeElement?.contentDocument!==doc)return;try{
      const before=renderedTimeline.current??previous;
      const resolved=mediaSession.current?.resolveAssets(playbackAssets)??playbackAssets;
      const sourceChanged=current.clips.some(clip=>clip.assetId&&renderedAssets.current.find(asset=>asset._id===clip.assetId)?.url!==resolved.find(asset=>asset._id===clip.assetId)?.url);
      const retained=updateLiveMediaContent(doc,before,current,resolved)&&updateLiveAdjustmentEffects(doc,before,current)&&updateLiveTextEffects(doc,before,current)&&updateLiveVisualEffects(doc,before,current)&&updateLiveVisualGeometry(doc,before,current,resolved)&&updateLiveScenes(doc,before,current);
      if(retained){
        mediaSession.current?.update(current,playbackAssets);updateLayers(active,current);
        if(sourceChanged||needsLiveMediaSync(before,current)){
          const sync=()=>active.seek(playbackTime(active));
          if(mediaSession.current)mediaSession.current.resync(sync);
          else {const resume=!active.paused;sync();if(resume)active.play();}
        }
        renderedTimeline.current=current;renderedAssets.current=resolved;setRevision(value=>value+1);
      }else setReloadRevision(value=>value+1);
    }catch(error){callbacks.current.onError(userError(error,'Could not update the preview.'));}};
    const used=usedAssetIds(current);
    const usedAssets=assets.filter(asset=>used.has(asset._id));
    const immediate=cache.cachedAssets(usedAssets).map(asset=>{
      const retained=renderedAssets.current.find(previous=>previous._id===asset._id);
      // Keep the current decoder while a newly advertised bounded derivative
      // downloads. Timeline/text edits do not wait for that background copy.
      return retained&&asset.previewUrl&&asset.url===asset.previewUrl&&asset.previewSize!==undefined&&asset.previewSize<=64*1024*1024?{...asset,url:retained.url}:asset;
    });
    // Small local copies swap in as soon as they finish; a long take's larger copy follows on its own.
    const prepared=[cache.prepare(usedAssets,controller.signal,MAX_PREVIEW_BYTES),cache.prepare(usedAssets,controller.signal)];
    const optional=loadPreviewRemotion(doc,current);
    if(optional)void optional.then(()=>apply(immediate),()=>{});else apply(immediate);
    for(const prepare of prepared)void Promise.all([prepare,optional]).then(([playbackAssets])=>{if(!cancelled&&player.current===active)callbacks.current.onPlaybackAssets?.(mediaSession.current?.resolveAssets(playbackAssets)??playbackAssets);apply(playbackAssets);},error=>{if(!cancelled)callbacks.current.onError(userError(error,'Could not load the preview renderer.'));});
    return()=>{cancelled=true;controller.abort();};
  },[committedTimeline,assets,contentKey,playerVersion]);
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
  useImperativeHandle(ref,()=>({retry:()=>setReloadRevision(value=>value+1),play:()=>{seekOwned.current=false;if(mediaSession.current){mediaSession.current.play();callbacks.current.onPlaying(mediaSession.current.isPlaying());}else player.current?.play();},pause:()=>{if(mediaSession.current)mediaSession.current.pause();else player.current?.pause();callbacks.current.onPlaying(false);},seek:(t)=>{
    seekPosition.current=t;seekRequest.current++;seekOwned.current=true;if(mediaSession.current)mediaSession.current.seek(t);else player.current?.seek(t);setSelectionVisible(selectionAt(t));
    // HyperFrames seek lands paused without emitting a pause event.
    callbacks.current.onPlaying(false);
  },currentTime:()=>playbackTime(player.current),mute:(v)=>{if(player.current)player.current.muted=v;},clipVolume:(id,volume)=>{
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
    let cancelled=false,loaded=false,swapped=false,waitingForMedia=false,disposed=false;
    let p:HyperframesPlayer|null=null,session:ReturnType<typeof createPreviewMediaSession>|undefined;
    let playbackAssets:MediaAsset[]=[],stagedTimeline=timeline,swapFrame=0,stopTrace:(()=>void)|undefined;
    let diagnosticTimer:ReturnType<typeof setTimeout>|undefined;
    const diagnose=(reason:string)=>{
      if(!p||!debugId)return;
      const doc=p.iframeElement?.contentDocument,win=doc?.defaultView as (Window&{__renderReady?:boolean;__player?:{isPlaying?():boolean;getTime?():number;getDuration?():number};__timelines?:{revline?:{time():number;paused():boolean;duration():number}};gsap?:{ticker:{time:number}}})|null;
      const media=Array.from(doc?.querySelectorAll<HTMLMediaElement>('video,audio')??[]);
      let runtime: {runtimePlaying?:boolean;runtimeTime?:number;runtimeDuration?:number;runtimeReadError?:boolean}={};
      try { const bridge=win?.__player;runtime={...(typeof bridge?.isPlaying==='function'?{runtimePlaying:bridge.isPlaying()}:{}),...(typeof bridge?.getTime==='function'?{runtimeTime:bridge.getTime()}:{}),...(typeof bridge?.getDuration==='function'?{runtimeDuration:bridge.getDuration()}: {})}; } catch { runtime={runtimeReadError:true}; }
      console.warn('[Revline playback]',JSON.stringify({chatId:debugId,reason,ready:p.ready,painted:p.painted,time:p.currentTime,paused:p.paused,buffering:session?.isBuffering()??false,playbackIntended:session?.isPlaying()??false,renderReady:win?.__renderReady,hasRuntime:!!win?.__player,...runtime,clock:playbackTime(p),clockPaused:win?.__timelines?.revline?.paused(),duration:win?.__timelines?.revline?.duration(),tickerTime:win?.gsap?.ticker.time,runtimeSrc:p.getAttribute('runtime-src'),scripts:Array.from(doc?.scripts??[],node=>node.src).filter(Boolean).map(url=>url.split('?')[0]),mediaCount:media.length,readyCount:media.filter(node=>node.readyState>=2).length,active:media.filter(node=>seekPosition.current>=Number(node.dataset.start)&&seekPosition.current<Number(node.dataset.end)).map(node=>{
        let buffered:number[][]=[];try{for(let index=0;index<node.buffered.length&&buffered.length<4;index++)if(node.buffered.end(index)>=node.currentTime-.05)buffered.push([node.buffered.start(index),node.buffered.end(index)]);}catch{/* A detached decoder may lose its ranges during capture. */}
        return{id:node.dataset.sourceClip,readyState:node.readyState,error:node.error?.code??null,paused:node.paused,seeking:node.seeking,preload:node.preload,networkState:node.networkState,sourceTime:node.currentTime,buffered};
      })}));
    };
    diagnostic.current=diagnose;
    const iframeError=(event:MessageEvent)=>{if(cancelled||event.source!==p?.iframeElement?.contentWindow||event.origin!==window.location.origin||event.data?.source!=='revline-preview-error')return;console.error(`[Revline preview error] ${event.data.label}: ${event.data.message}`,{chatId:debugId});callbacks.current.onError(`Preview: ${event.data.message}`);};
    window.addEventListener('message',iframeError);
    const preparation=new AbortController(),cache=sourceCache.current!;
    const disposePlayer=()=>{
      if(disposed)return;disposed=true;preparation.abort();
      window.removeEventListener('message',iframeError);if(diagnosticTimer)clearTimeout(diagnosticTimer);
      cancelAnimationFrame(swapFrame);stopTrace?.();session?.dispose();p?.pause();p?.remove();
    };
    const used=usedAssetIds(timeline);
    void Promise.all([import('@hyperframes/player'),openingAssets(cache,assets.filter(asset=>used.has(asset._id)),preparation.signal)]).then(([,prepared])=>{
      if(cancelled||!container.current)return;
      playbackAssets=prepared;callbacks.current.onPlaybackAssets?.(prepared);p=document.createElement('hyperframes-player') as HyperframesPlayer;
      p.muted=true;p.style.cssText='position:absolute;inset:0;width:100%;height:100%;z-index:0';p.setAttribute('assets-loading-ui','none');p.setAttribute('runtime-src',`${window.location.origin}/vendor/hyperframe.runtime.iife.js?v=managed-media-5`);p.setAttribute('disable-click-to-play','');p.removeAttribute('controls');
      p.setAttribute('srcdoc',generateComposition(timeline,playbackAssets,{preview:true,gsapUrl:`${window.location.origin}/vendor/gsap.min.js`,visualEffectsUrl:`${window.location.origin}/vendor/visual-effects.js?v=pixel-track-streams-14`,remotionRuntimeUrl:`${window.location.origin}/vendor/remotion-runtime.js?v=custom-typography-3`}));
      const swap=()=>{
        if(cancelled||!p||swapped||!loaded||waitingForMedia||!session)return;
        waitingForMedia=true;
        void(async()=>{
          const current=latestTimeline.current,committed=latestCommittedTimeline.current,used=usedAssetIds(current);
          const prepared=await openingAssets(cache,latestAssets.current.filter(asset=>used.has(asset._id)),preparation.signal);
          if(cancelled||!p||!session)return;
          const doc=p.iframeElement?.contentDocument;if(!doc)return;
          await loadPreviewRemotion(doc,current);
          if(cancelled)return;
          updateLiveMediaContent(doc,stagedTimeline,current,prepared);updateLiveTextEffects(doc,stagedTimeline,current);updateLiveVisualEffects(doc,stagedTimeline,current);updateLiveVisualGeometry(doc,stagedTimeline,current,prepared);updateLiveScenes(doc,stagedTimeline,current);updateLiveAdjustmentEffects(doc,stagedTimeline,current);stagedTimeline=current;
          // Seeks while this replacement loads only reach the displayed player.
          const requested=seekRequest.current;
          playbackAssets=prepared;session.update(current,prepared);session.seek(seekPosition.current);updateLayers(p,current);
          await session.whenReady(seekPosition.current,preparation.signal,callbacks.current.onThumbnail,()=>callbacks.current.onSlowLoad?.());
          swapFrame=requestAnimationFrame(()=>{swapFrame=requestAnimationFrame(()=>{
            if(cancelled||!p||!session||swapped)return;
            if(latestCommittedTimeline.current!==committed||seekRequest.current!==requested){waitingForMedia=false;swap();return;}
            swapped=true;const previous=disposeDisplayed.current,resume=mediaSession.current?.isPlaying()??false;
            player.current=p;mediaSession.current=session;disposeDisplayed.current=disposePlayer;
            p.muted=mutedRef.current;p.style.zIndex='1';previous?.();
            renderedTimeline.current=current;renderedAssets.current=playbackAssets;renderedContentKey.current=contentKey;
            setSelectionVisible(selectionAt(seekPosition.current));callbacks.current.onTime(seekPosition.current);setReady(true);setBuffering(false);callbacks.current.onReady?.();setRevision(value=>value+1);setPlayerVersion(value=>value+1);if(resume)session.play();
          });});
        })().catch(error=>{if(!cancelled&&!preparation.signal.aborted)callbacks.current.onError(userError(error,'The footage could not load.'));});
      };
      p.addEventListener('ready',()=>{
        if(cancelled||!p)return;
        const doc=p.iframeElement?.contentDocument;if(!doc)return;
        session=createPreviewMediaSession({document:doc,transport:p,readTime:()=>playbackTime(p),timeline,assets:playbackAssets,
          refreshMedia:ids=>callbacks.current.onRefreshMedia?.(ids)??Promise.resolve(playbackAssets.filter(asset=>ids.includes(asset._id)).map(asset=>({_id:asset._id,url:asset.url}))),
          onError:message=>{if(player.current===p||!swapped&&!cancelled)callbacks.current.onError(message);},
          onWaiting:waiting=>{if(player.current===p)setBuffering(waiting);},onSlowLoad:()=>callbacks.current.onSlowLoad?.(),onDiagnostic:debugId?diagnose:undefined});
        if(debugId&&(process.env.NODE_ENV==='development'||new URLSearchParams(window.location.search).get('playbackDebug')==='1'))stopTrace=tracePreviewPlayback(doc,p,()=>playbackTime(p),()=>({playing:session?.isPlaying()??false,buffering:session?.isBuffering()??false}),debugId);
        loaded=true;session.seek(seekPosition.current);updateLayers(p,latestTimeline.current);if(p.painted)swap();
      });
      p.addEventListener('painted',swap);
      p.addEventListener('timeupdate',(e)=>{if(!loaded||player.current!==p||seekOwned.current&&p?.paused)return;const detail=(e as CustomEvent<{currentTime:number}>).detail;const t=frameTime(p,detail?.currentTime??seekPosition.current);seekPosition.current=t;setSelectionVisible(selectionAt(t));callbacks.current.onTime(t);});
      const stopped=()=>{if(!loaded||player.current!==p)return;const t=playbackTime(p);seekPosition.current=t;callbacks.current.onTime(t);if(!session?.isBuffering())callbacks.current.onPlaying(false);};
      p.addEventListener('play',()=>{if(p&&loaded&&player.current===p){callbacks.current.onPlaying(true);const start=p.currentTime;if(diagnosticTimer)clearTimeout(diagnosticTimer);diagnosticTimer=setTimeout(()=>{if(p&&!p.paused&&p.currentTime<=start+.05)diagnose('clock did not advance after Play');},1200);}});p.addEventListener('pause',stopped);p.addEventListener('ended',stopped);
      p.addEventListener('error',()=>{if(!cancelled){diagnose('player error');callbacks.current.onError('The preview could not load this media. Try an MP4 with H.264 video.');}});
      container.current.appendChild(p);if(debugId)diagnosticTimer=setTimeout(()=>{if(p&&!p.ready)diagnose('player readiness stalled');},4000);
    }).catch(error=>{if(!cancelled&&!preparation.signal.aborted)callbacks.current.onError(userError(error,'Could not load the preview.'));});
    // A displayed session keeps owning its decoded frame until its replacement
    // paints. Pending replacement work can be cancelled independently.
    return()=>{cancelled=true;preparation.abort();cancelAnimationFrame(swapFrame);if(!p||player.current!==p)disposePlayer();};
  },[contentKey,reloadRevision]);
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
      const node=doc?compositionNode(doc,clip,index):null;return node?[{id:clip.id,rect:projectPreviewBounds(node.getBoundingClientRect(),composition,canvas)}]:[];
    }):[];
    const hit=previewClipAtPoint(timeline,assets,playbackTime(player.current),point,textBounds,{mediaOpacities:doc?previewMediaOpacities(doc):undefined,cycleAfter:event.altKey?selectedClip?.id??null:undefined});
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
    {safeArea&&timeline.aspectRatio==='vertical'&&<SafeAreaOverlay platform={safeArea}/>}
    {(!ready||buffering)&&<div className="preview-loading" style={buffering?{background:'transparent',zIndex:2,pointerEvents:'none'}:undefined} role="status" aria-label={buffering?'Loading clip':'Loading preview'}><LoaderCircle className="animate-spin" size={20}/></div>}</div>;
});
