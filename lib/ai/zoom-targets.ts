import type { FrameInspection, FrameTarget } from '../media-analysis/frame-inspection';
import { validateFrameInspectionResult } from '../media-analysis/frame-inspection';
import { sourceEndOf, timelineTimeAtSource } from '../editor/playback-rate';
import { smoothZoomPatch } from '../editor/smooth-zoom';
import type { SmoothZoomSettings } from '../editor/smooth-zoom-settings';
import type { AspectRatio, Clip, MediaAsset } from '../editor/types';
export type ZoomTargetEvidence = FrameTarget & {assetId:string;sourceWidth:number;sourceHeight:number;sourceFps?:number};
export type ZoomFocusInput = {kind:'center'}|{kind:'coordinates';centerX:number;centerY:number;units?:'normalized'|'pixels'}|{kind:'target';targetId:string};
export type ZoomTimingInput = {start:number;inDuration:number;holdDuration:number;outDuration:number;scale:number;easing:SmoothZoomSettings['easing'];framing?:SmoothZoomSettings['framing'];replaceMotion?:boolean};
export function rememberZoomTargets(result:FrameInspection,assetId:string,registry:Map<string,ZoomTargetEvidence>,id:()=>string=()=>crypto.randomUUID()){
  validateFrameInspectionResult(result,result);
  return (result.targets??[]).map(target=>{
    const targetId=id();
    registry.set(targetId,{...target,assetId,sourceWidth:result.geometry!.sourceWidth,sourceHeight:result.geometry!.sourceHeight,sourceFps:result.sourceFps});
    return {...target,targetId};
  });
}
/** Resolve source geometry once for both zoom recipes and camera paths. */
export function resolveZoomFocus(clip:Clip,asset:MediaAsset,focus:ZoomFocusInput,registry:ReadonlyMap<string,ZoomTargetEvidence>){
  let centerX=.5,centerY=.5,target:ZoomTargetEvidence|undefined;
  if(focus.kind==='coordinates'){
    centerX=focus.centerX;centerY=focus.centerY;
    if(focus.units==='pixels'){
      if(!asset.width||!asset.height)throw new Error('Source dimensions are required for pixel camera coordinates.');
      centerX/=asset.width;centerY/=asset.height;
    }
  }else if(focus.kind==='target'){
    target=registry.get(focus.targetId);
    if(!target)throw new Error('Inspect the requested target in this request before positioning the camera.');
    if(target.assetId!==clip.assetId||asset._id!==target.assetId||asset.width!==target.sourceWidth||asset.height!==target.sourceHeight)throw new Error('The inspected camera target does not match this clip source geometry.');
    if(target.confidence==='low')throw new Error('The target location is uncertain. Inspect a clearer nearby frame before positioning the camera.');
    if(target.time<clip.sourceStart-1e-9||target.time>=sourceEndOf(clip)-1e-9)throw new Error('The inspected target is outside this retained clip.');
    centerX=(target.box.left+target.box.right)/2;centerY=(target.box.top+target.box.bottom)/2;
  }
  if(!Number.isFinite(centerX)||!Number.isFinite(centerY)||centerX<0||centerX>1||centerY<0||centerY>1)throw new Error('Camera focus must use normalized original-source coordinates between 0 and 1.');
  return {centerX,centerY,target};
}

/** Source-time evidence and source geometry stay separate from the timeline clock. */
export function configureSmoothZoomPatch(clip:Clip,asset:MediaAsset,aspectRatio:AspectRatio,input:ZoomTimingInput,focus:ZoomFocusInput,registry:ReadonlyMap<string,ZoomTargetEvidence>){
  const {centerX,centerY,target}=resolveZoomFocus(clip,asset,focus,registry);
  if(target){
    const time=timelineTimeAtSource(clip,target.time);
    const end=input.outDuration>0?input.start+input.inDuration+input.holdDuration:clip.start+clip.duration;
    if(time<input.start-1/60||time>end+1/60)throw new Error('Inspect the target during this zoom window, not a different moment.');
  }
  if(!Number.isFinite(input.start)||input.start<clip.start-1e-9||input.start>=clip.start+clip.duration)throw new Error('The zoom start must be inside this clip in timeline seconds.');
  // Animation timing is local timeline time, never divided by source playback rate.
  const settings={start:input.start-clip.start,inDuration:input.inDuration,holdDuration:input.holdDuration,outDuration:input.outDuration,scale:input.scale,easing:input.easing,framing:input.framing??(focus.kind==='target'?'center':'anchor'),centerX,centerY};
  return smoothZoomPatch(clip,asset,aspectRatio,settings,{replace:input.replaceMotion});
}
