import { motionAt, type MotionKeyframe } from './motion-path';
import type { Clip } from './types';
import type { DirectionalBlur, ZoomBlur } from './visual-effects';

export type CameraGlideBlurSource = {start:number;duration:number;motionOffset:number;amount:number;motion:MotionKeyframe[]};

/** No additional clock or saved effect: derive blur from canonical camera velocity. */
export function cameraGlideBlurSource(clip:Clip):CameraGlideBlurSource|undefined{
  // A camera path's own blur setting, or the clip's motion blur for any keyframed movement.
  const amount=clip.cameraMotion?.blurAmount||clip.motionBlur;
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

/** Radial blur from how fast the clip scales (pop-ins, punch zooms), centered on the frame. */
export function motionZoomBlurAt(source:CameraGlideBlurSource|undefined,time:number):ZoomBlur|undefined{
  if(!source||source.amount<=0||time<source.start||time>=source.start+source.duration)return;
  const at=time-source.start+source.motionOffset,keys=source.motion;
  if(keys.length<2||at<=keys[0].time||at>=keys.at(-1)!.time)return;
  const step=1/60,from=motionAt(keys,at),to=motionAt(keys,at+step),rate=Math.abs(to.scale-from.scale)/step/Math.max(.01,from.scale);
  const amount=Math.min(.3,rate*source.amount*.08);
  return amount>.004?{enabled:true,amount,centerX:.5,centerY:.5}:undefined;
}

/** CSS blur radius (px at 1080p) for text and solid layers, from translation and scale speed. */
export function cssMotionBlur(keys:MotionKeyframe[],at:number,amount:number|undefined,width:number,height:number){
  if(!amount||amount<=0||keys.length<2||at<=keys[0].time||at>=keys.at(-1)!.time)return 0;
  const step=1/60,from=motionAt(keys,at),to=motionAt(keys,at+step);
  const speed=Math.hypot((to.x-from.x)*width,(to.y-from.y)*height)/step,scaleRate=Math.abs(to.scale-from.scale)/step/Math.max(.01,from.scale);
  return Math.min(16,(speed/120+scaleRate*4)*amount);
}
