import {DEFAULT_COLOR_GRADE,DEFAULT_DITHER,DEFAULT_GLITCH,DEFAULT_INVERT,DEFAULT_ZOOM_BLUR,validateVisualEffects,type VisualEffects} from './visual-effects';
import type {Clip} from './types';
import {DEFAULT_NEON_EDGES} from './neon-edges';

export const VISUAL_EFFECT_GROUPS=['colorGrade','zoomBlur','glitch','invert','dither','neonEdges'] as const;
export type VisualEffectGroup=typeof VISUAL_EFFECT_GROUPS[number];
const defaults={colorGrade:DEFAULT_COLOR_GRADE,zoomBlur:DEFAULT_ZOOM_BLUR,glitch:DEFAULT_GLITCH,invert:DEFAULT_INVERT,dither:DEFAULT_DITHER,neonEdges:DEFAULT_NEON_EDGES};
/** Match manual group reset/removal and palette reset without touching other controls. */
export function visualEffectActionPatch(clip:Clip,effect:VisualEffectGroup,action:'reset'|'remove'|'original-colors'):VisualEffects{
  if((clip.kind!=='video'&&clip.kind!=='image')&&!(clip.kind==='effect'&&clip.effectPreset==='zoom-blur'&&effect==='zoomBlur'))throw new Error('Choose visual footage or its timed zoom-blur FX.');
  if(action==='original-colors'&&effect!=='dither')throw new Error('Original palette colors apply to dither only.');
  const settings=action==='remove'?undefined:action==='original-colors'?{...DEFAULT_DITHER,...clip.dither,shadowColor:undefined,highlightColor:undefined}:{...defaults[effect],enabled:clip[effect]?.enabled??false};
  const patch={[effect]:settings};validateVisualEffects({...clip,...patch});return patch;
}
