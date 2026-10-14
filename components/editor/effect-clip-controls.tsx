'use client';

import type {Clip} from '@/lib/editor/types';
import {configureTimedEffectPatch,frameShrinkSettings,FRAME_SHRINK_LIMITS,type FrameShrinkSettings} from '@/lib/editor/clip-effects';
import {EffectSlider} from './effect-slider';

export function FrameShrinkControls({clip,onChange,onPreview}:{clip:Clip;onChange:(patch:Partial<Clip>)=>void;onPreview?:(patch:Partial<Clip>|null)=>void}){
  const settings=frameShrinkSettings(clip);
  const patch=(key:keyof FrameShrinkSettings,value:number)=>configureTimedEffectPatch(clip,{frameShrink:{[key]:value}});
  return <div className="visual-effects-controls" aria-label="Frame shrink settings">
    <div className="inspector-selection"><small>Effect</small><p>Frame shrink</p></div>
    {(['size','speed'] as const).map(key=><EffectSlider key={key} label={key==='size'?'Size':'Speed'} value={settings[key]} bounds={FRAME_SHRINK_LIMITS[key]} step={key==='size'?.01:.25} format={value=>key==='size'?`${Math.round(value*100)}%`:`${value}×`} disabled={false} onPreview={value=>onPreview?.(value===null?null:patch(key,value))} onCommit={value=>onChange(patch(key,value))}/>)}
    <small>Size adds space on every side. Trim the FX clip to change the hold.</small>
  </div>;
}
