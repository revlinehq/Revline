import {DEFAULT_DITHER,VISUAL_EFFECT_DEFAULTS,VISUAL_EFFECT_KEYS,validateVisualEffects,type VisualEffects} from './visual-effects';
import type {Clip} from './types';

export const VISUAL_EFFECT_GROUPS=VISUAL_EFFECT_KEYS;
export type VisualEffectGroup=typeof VISUAL_EFFECT_GROUPS[number];
/** Groups offered for new edits; retired ones stay renderable in saved projects. */
const RETIRED_VISUAL_EFFECT_GROUPS:readonly string[]=['dither','neonEdges','lightLeak','zoomBlur','lensDistortion','frameDistortion','directionalBlur'];
export const OFFERED_VISUAL_EFFECT_GROUPS=VISUAL_EFFECT_GROUPS.filter(group=>!RETIRED_VISUAL_EFFECT_GROUPS.includes(group)) as [VisualEffectGroup,...VisualEffectGroup[]];
/** Match manual group reset/removal and palette reset without touching other controls. */
export function visualEffectActionPatch(clip:Clip,effect:VisualEffectGroup,action:'reset'|'remove'|'original-colors'):VisualEffects{
  if((clip.kind!=='video'&&clip.kind!=='image')&&!(clip.kind==='effect'&&clip.effectPreset==='zoom-blur'&&effect==='zoomBlur'))throw new Error('Choose visual footage or its timed zoom-blur FX.');
  if(action==='original-colors'&&effect!=='dither')throw new Error('Original palette colors apply to dither only.');
  const settings=action==='remove'?undefined:action==='original-colors'?{...DEFAULT_DITHER,...clip.dither,shadowColor:undefined,highlightColor:undefined}:{...VISUAL_EFFECT_DEFAULTS[effect],enabled:clip[effect]?.enabled??false};
  const patch={[effect]:settings};validateVisualEffects({...clip,...patch});return patch;
}
