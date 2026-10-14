'use client';

import { useId } from 'react';
import type {Clip} from '@/lib/editor/types';
import {EFFECT_CATALOG,configureTimedEffectPatch,frameShrinkSettings,FRAME_SHRINK_LIMITS,type FrameShrinkSettings,zoomSettings,ZOOM_LIMITS,type ZoomSettings} from '@/lib/editor/clip-effects';
import {EffectSlider} from './effect-slider';
import { SegmentedTabs } from './segmented-tabs';
import { isPropertyEffectPreset, flashSettings, punchSettings, shakeSettings, popSettings, type MotionEffectChanges, FLASH_LIMITS, PUNCH_LIMITS, SHAKE_LIMITS, POP_LIMITS } from '@/lib/editor/motion-effect-settings';

export function MotionEffectControls({ clip, fps=30, onChange, onPreview }: { clip: Clip; fps?: number; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const id=useId(), preset=clip.effectPreset;
  if (!isPropertyEffectPreset(preset)) return null;
  const patch=(property:string,value:number)=>configureTimedEffectPatch(clip,{[preset]:{[property]:value}} as MotionEffectChanges);
  const percent=(value:number)=>`${Math.round(value*100)}%`, multiple=(value:number)=>`${Number(value.toFixed(2))}×`;
  type Field={property:string;label:string;value:number;bounds:readonly[number,number];step:number;format:(value:number)=>string};
  let fields:Field[];
  if(preset==='flash'){
    const flash=flashSettings(clip);
    fields=[{property:'strength',label:'Strength',value:flash.strength,bounds:FLASH_LIMITS.strength,step:.01,format:percent},
      {property:'attack',label:'Attack',value:flash.attack,bounds:[.01,Math.min(.99,1-flash.release)],step:.01,format:value=>`${(value*clip.duration).toFixed(2)} s`},
      {property:'release',label:'Release',value:flash.release,bounds:[.01,Math.min(.99,1-flash.attack)],step:.01,format:value=>`${(value*clip.duration).toFixed(2)} s`}];
  }else if(preset==='punch'){
    const punch=punchSettings(clip);
    fields=[{property:'amount',label:'Amount',value:punch.amount,bounds:PUNCH_LIMITS.amount,step:.05,format:multiple},{property:'speed',label:'Recovery speed',value:punch.speed,bounds:PUNCH_LIMITS.speed,step:.25,format:multiple},
      ...(['centerX','centerY'] as const).map(property=>({property,label:property==='centerX'?'Center X':'Center Y',value:punch[property],bounds:PUNCH_LIMITS[property],step:.01,format:percent}))];
  }else if(preset==='shake'){
    const shake=shakeSettings(clip);
    fields=[{property:'strength',label:'Strength',value:shake.strength,bounds:SHAKE_LIMITS.strength,step:.01,format:percent},{property:'speed',label:'Shake speed',value:shake.speed,bounds:SHAKE_LIMITS.speed,step:.25,format:multiple}];
  }else{
    const pop=popSettings(clip);
    fields=[{property:'startScale',label:'Starting size',value:pop.startScale,bounds:POP_LIMITS.startScale,step:.01,format:percent},{property:'bounce',label:'Bounce',value:pop.bounce,bounds:POP_LIMITS.bounce,step:.01,format:percent},{property:'speed',label:'Speed',value:pop.speed,bounds:POP_LIMITS.speed,step:.25,format:multiple}];
  }
  return <div className="visual-effects-controls" aria-label={`${preset} settings`}>
    <div className="inspector-selection"><small>Effect</small><p>{EFFECT_CATALOG[preset].label}</p></div>
    <EffectSlider label="Duration" value={clip.duration} bounds={[1/fps,Math.max(30,clip.duration)]} step={1/fps} format={value=>`${value.toFixed(2)} s`} disabled={false} onPreview={value=>onPreview?.(value===null?null:configureTimedEffectPatch(clip,{duration:value}))} onCommit={duration=>onChange(configureTimedEffectPatch(clip,{duration}))}/>
    {preset==='shake'&&<SegmentedTabs label="Shake direction" value={shakeSettings(clip).direction} onChange={direction=>onChange(configureTimedEffectPatch(clip,{shake:{direction}}))} options={[
      {value:'both',label:'Both',id:`${id}-both`,panelId:`${id}-fields`},{value:'horizontal',label:'Left / right',id:`${id}-horizontal`,panelId:`${id}-fields`},{value:'vertical',label:'Up / down',id:`${id}-vertical`,panelId:`${id}-fields`}]}/>}
    <div className="visual-effect-fields" id={`${id}-fields`} role={preset==='shake'?'tabpanel':undefined} aria-labelledby={preset==='shake'?`${id}-${shakeSettings(clip).direction}`:undefined}>
      {fields.map(field=><EffectSlider key={field.property} label={field.label} value={field.value} bounds={field.bounds} step={field.step} format={field.format} disabled={false} onPreview={value=>onPreview?.(value===null?null:patch(field.property,value))} onCommit={value=>onChange(patch(field.property,value))}/>)}
    </div>
  </div>;
}

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
