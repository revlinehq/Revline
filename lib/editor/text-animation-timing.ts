import type { Clip } from './types';

/** Freeze the original basic entrance/exit clock when a text range is trimmed or split. */
export function textAnimationTimingPatch(clip:Pick<Clip,'animation'|'duration'|'textAnimationTiming'>,delta=0):Pick<Clip,'textAnimationTiming'>|Record<string,never>{
  return clip.animation==='fade'||clip.animation==='rise'?{textAnimationTiming:{duration:clip.textAnimationTiming?.duration??clip.duration,offset:(clip.textAnimationTiming?.offset??0)+delta}}:{};
}
export function validateTextAnimationTiming(clip:Pick<Clip,'kind'|'animation'|'textAnimationTiming'>){
  const timing=clip.textAnimationTiming;if(timing===undefined)return;
  if((clip.kind!=='caption'&&clip.kind!=='graphic')||(clip.animation!=='fade'&&clip.animation!=='rise'))throw new Error('Text animation timing belongs to basic Fade or Rise text animations.');
  if(!Number.isFinite(timing.duration)||timing.duration<=0||!Number.isFinite(timing.offset))throw new Error('Text animation timing needs a positive finite duration and finite offset.');
}
