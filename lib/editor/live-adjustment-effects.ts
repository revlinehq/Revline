import { adjustmentSources, type AdjustmentController } from './adjustment-layers';
import { isTransitionClip, transitionSources } from './clip-transitions';
import type { TransitionController } from './remotion-transitions-runtime';
import { validateClipEffects } from './clip-effects';
import type { Clip, Timeline } from './types';
import { solidColorSources, type SolidColorController } from './solid-color-layers';

const controllerOf=(document:Document)=>(document.defaultView as (Window&{__revlineAdjustmentController?:AdjustmentController})|null)?.__revlineAdjustmentController;
const transitionsOf=(document:Document)=>(document.defaultView as (Window&{__revlineTransitionController?:TransitionController})|null)?.__revlineTransitionController;
const colorsOf=(document:Document)=>(document.defaultView as (Window&{__revlineSolidColorController?:SolidColorController})|null)?.__revlineSolidColorController;
export function previewAdjustmentEffect(document:Document,clip:Clip,_index:number,patch:Partial<Clip>|null):boolean {
  validateClipEffects({...clip,...patch});
  if(clip.kind==='solid')return colorsOf(document)?.preview(clip.id,patch)??false;
  if(isTransitionClip(clip))return transitionsOf(document)?.preview(clip.id,patch)??false;
  return controllerOf(document)?.preview(clip.id,patch)??false;
}
/** All FX changes, including creation/deletion and ordering, keep decoded footage mounted. */
export function updateLiveAdjustmentEffects(document:Document,_previous:Timeline,next:Timeline):boolean {
  const controller=controllerOf(document);if(!controller)return false;
  const sources=transitionSources(next.clips,next.fps);
  let transitions=transitionsOf(document);
  if(!transitions&&sources.length){
    const runtime=(document.defaultView as (Window&{__revlineRemotionTransitions?:{installTransitions(initial:ReturnType<typeof transitionSources>,fps:number):TransitionController}})|null)?.__revlineRemotionTransitions;
    if(!runtime)return false;transitions=runtime.installTransitions(sources,next.fps);
  }
  controller.setSources(adjustmentSources(next.clips));
  const colors=colorsOf(document);if(!colors)return false;
  colors.setSources(solidColorSources(next.clips));transitions?.setSources(sources);return true;
}
