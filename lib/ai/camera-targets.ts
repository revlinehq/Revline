import { cameraMotionPatch } from '../editor/camera-motion';
import { sourceTimeAt } from '../editor/playback-rate';
import type { CameraMotionSettings } from '../editor/camera-motion-settings';
import type { AspectRatio, Clip, MediaAsset } from '../editor/types';
import { resolveZoomFocus, type ZoomFocusInput, type ZoomTargetEvidence } from './zoom-targets';

export type CameraMotionInput = {
  keyframes: {time:number;scale:number;easing:CameraMotionSettings['keyframes'][number]['easing'];focus:ZoomFocusInput}[];
  mode?: 'glide' | 'follow';
  replaceMotion?: boolean;
};

/** Every moving-target anchor is bound to a decoded frame at that source instant. */
export function configureCameraMotionPatch(clip:Clip,asset:MediaAsset,aspectRatio:AspectRatio,input:CameraMotionInput,registry:ReadonlyMap<string,ZoomTargetEvidence>){
  if(input.keyframes.length<2||input.keyframes.length>8)throw new Error('Use between two and eight camera keyframes in one path.');
  const keyframes=input.keyframes.map(key=>{
    if(!Number.isFinite(key.time)||key.time<clip.start-1e-9||key.time>clip.start+clip.duration+1e-9)throw new Error('Camera keyframe times must stay within this clip in timeline seconds.');
    const {centerX,centerY,target}=resolveZoomFocus(clip,asset,key.focus,registry);
    if(input.mode==='follow'){
      if(key.focus.kind==='center')throw new Error('Following requires observed target samples or explicit user-provided positions at each keyframe.');
      if(target){
        const tolerance=1/(target.sourceFps??30)+1e-6;
        if(Math.abs(target.time-sourceTimeAt(clip,key.time))>tolerance)throw new Error('Inspect the moving target at this keyframe source time. A position from another moment cannot verify cursor or object following.');
      }
    }
    return {time:Math.max(0,Math.min(clip.duration,key.time-clip.start)),scale:key.scale,easing:key.easing,centerX,centerY};
  });
  return cameraMotionPatch(clip,asset,aspectRatio,{keyframes},{replace:input.replaceMotion});
}
