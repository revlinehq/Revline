import { adjustmentSources, type AdjustmentController } from './adjustment-layers';
import { validateClipEffects } from './clip-effects';
import type { Clip, Timeline } from './types';

const controllerOf=(document:Document)=>(document.defaultView as (Window&{__revlineAdjustmentController?:AdjustmentController})|null)?.__revlineAdjustmentController;
export function previewAdjustmentEffect(document:Document,clip:Clip,_index:number,patch:Partial<Clip>|null):boolean {
  validateClipEffects({...clip,...patch});
  return controllerOf(document)?.preview(clip.id,patch)??false;
}
/** All FX changes, including creation/deletion and ordering, keep decoded footage mounted. */
export function updateLiveAdjustmentEffects(document:Document,_previous:Timeline,next:Timeline):boolean {
  const controller=controllerOf(document);if(!controller)return false;
  controller.setSources(adjustmentSources(next.clips));return true;
}
