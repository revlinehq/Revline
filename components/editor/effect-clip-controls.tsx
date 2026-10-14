'use client';

import { useId } from 'react';
import type {Clip} from '@/lib/editor/types';
import {configureTimedEffectPatch,frameShrinkSettings,FRAME_SHRINK_LIMITS,type FrameShrinkSettings,zoomSettings,ZOOM_LIMITS,type ZoomSettings} from '@/lib/editor/clip-effects';
import {EffectSlider} from './effect-slider';
import { SegmentedTabs } from './segmented-tabs';

export function ZoomControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const settings = zoomSettings(clip), id = useId();
  const patch = (zoom: Partial<ZoomSettings>) => configureTimedEffectPatch(clip, { zoom });
  return <div className="visual-effects-controls" aria-label="Zoom settings">
    <div className="inspector-selection"><small>Effect</small><p>Zoom</p></div>
    <SegmentedTabs label="Zoom direction" value={settings.direction} onChange={direction => onChange(patch({ direction }))} options={[{ value: 'in', label: 'In', id: `${id}-in`, panelId: `${id}-controls` }, { value: 'out', label: 'Out', id: `${id}-out`, panelId: `${id}-controls` }]}/>
    <div className="visual-effect-fields" id={`${id}-controls`} role="tabpanel" aria-labelledby={`${id}-${settings.direction}`}>
    {(['amount', 'speed', 'centerX', 'centerY'] as const).map(property => <EffectSlider key={property} label={{ amount: 'Amount', speed: 'Speed', centerX: 'Center X', centerY: 'Center Y' }[property]} value={settings[property]} bounds={ZOOM_LIMITS[property]} step={property === 'amount' || property === 'speed' ? .05 : .01} format={value => property === 'amount' || property === 'speed' ? `${Number(value.toFixed(2))}×` : `${Math.round(value * 100)}%`} disabled={false} onPreview={value => onPreview?.(value === null ? null : patch({ [property]: value }))} onCommit={value => onChange(patch({ [property]: value }))}/>)}
    </div>
  </div>;
}

export function FrameShrinkControls({clip,onChange,onPreview}:{clip:Clip;onChange:(patch:Partial<Clip>)=>void;onPreview?:(patch:Partial<Clip>|null)=>void}){
  const settings=frameShrinkSettings(clip);
  const patch=(key:keyof FrameShrinkSettings,value:number)=>configureTimedEffectPatch(clip,{frameShrink:{[key]:value}});
  return <div className="visual-effects-controls" aria-label="Frame shrink settings">
    <div className="inspector-selection"><small>Effect</small><p>Frame shrink</p></div>
    {(['size','speed'] as const).map(key=><EffectSlider key={key} label={key==='size'?'Size':'Speed'} value={settings[key]} bounds={FRAME_SHRINK_LIMITS[key]} step={key==='size'?.01:.25} format={value=>key==='size'?`${Math.round(value*100)}%`:`${value}×`} disabled={false} onPreview={value=>onPreview?.(value===null?null:patch(key,value))} onCommit={value=>onChange(patch(key,value))}/>)}
    <small>Size adds space on every side. Trim the FX clip to change the hold.</small>
  </div>;
}
