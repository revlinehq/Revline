import { motionAt, type MotionKeyframe } from './motion-path';
import type { Clip } from './types';
import type { DirectionalBlur } from './visual-effects';

export type CameraGlideBlurSource = {start:number;duration:number;motionOffset:number;amount:number;motion:MotionKeyframe[]};

/** No additional clock or saved effect: derive blur from canonical camera velocity. */
export function cameraGlideBlurSource(clip:Clip):CameraGlideBlurSource|undefined{
  const amount=clip.cameraMotion?.blurAmount;
  if(!amount||amount<=0||!clip.motion?.length)return;
  return {start:clip.start,duration:clip.duration,motionOffset:clip.motionOffset??0,amount,motion:clip.motion};
}

/** Design-pixel shutter radius, local to the source before its camera/static transforms. */
export function cameraGlideBlurAt(source:CameraGlideBlurSource|undefined,time:number,width:number,height:number):DirectionalBlur|undefined{
  if(!source||source.amount<=0||time<source.start||time>=source.start+source.duration)return;
  const at=time-source.start+source.motionOffset,keys=source.motion;
  if(keys.length<2||at<=keys[0].time||at>=keys.at(-1)!.time)return;
  const end=keys.findIndex(key=>key.time>at);if(end<1)return;
  const from=keys[end-1],to=keys[end],span=to.time-from.time;
  if(span<=0)return;
  const dx=(to.x-from.x)*width/span,dy=(to.y-from.y)*height/span;
  if(Math.hypot(dx,dy)<1e-8)return;
  const scale=Math.max(.01,motionAt(keys,at).scale);
  // 180° shutter at 30fps, expressed as a symmetric half-length. The effect
  // remains deterministic when exported at a different output frame rate.
  const amount=Math.min(40,Math.hypot(dx,dy)*source.amount/120/scale);
  return amount>1e-4?{enabled:true,amount,angle:Math.atan2(dy,dx)*180/Math.PI}:undefined;
}
