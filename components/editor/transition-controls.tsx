'use client';

import { ArrowRight } from 'lucide-react';
import type { Clip, MediaAsset, Timeline } from '@/lib/editor/types';
import { EFFECT_CATALOG } from '@/lib/editor/clip-effects';
import { boundedTransitionRange, isTransitionPreset, transitionDurationLimit, transitionPair, transitionWipeSettings, TRANSITION_DIRECTIONS, WIPE_DIRECTIONS, IRIS_SHAPES } from '@/lib/editor/clip-transitions';
import { EffectIcon } from './effect-icon';
import { EffectSlider } from './effect-slider';
import { InspectorSelect } from './inspector-select';
import './transition-controls.css';

const directionLabels = { clockwise: 'Clockwise', 'counter-clockwise': 'Counter-clockwise' } as const;
const wipeLabels = { left: 'To left', right: 'To right', up: 'Upward', down: 'Downward' } as const;

export function TransitionControls({ clip, timeline, assets, onChange, onPreview }: { clip: Clip; timeline: Timeline; assets: readonly MediaAsset[]; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const preset = clip.effectPreset;
  if (!isTransitionPreset(preset) || !clip.transition) return null;
  const { from, to } = transitionPair(timeline.clips, clip.transition);
  const wipe = transitionWipeSettings(clip.transition);
  const minimum = 2 / timeline.fps, maximum = transitionDurationLimit(timeline, clip);
  const sourceName = (source: Clip) => assets.find(asset => asset._id === source.assetId)?.fileName || 'Footage clip';
  return <section className="transition-controls" aria-label={`${EFFECT_CATALOG[preset].label} transition settings`}>
    <div className="transition-heading"><h3><EffectIcon name={preset} size={18}/>{EFFECT_CATALOG[preset].label}</h3><small>Clip-to-clip transition</small></div>
    <div className="transition-pair" aria-label="Connected clips"><div><small>From</small><p title={sourceName(from)}>{sourceName(from)}</p></div><ArrowRight size={14} aria-hidden="true"/><div><small>To</small><p title={sourceName(to)}>{sourceName(to)}</p></div></div>
    <EffectSlider label="Duration" value={clip.duration} bounds={[minimum, maximum]} step={1 / timeline.fps} format={value => `${value.toFixed(2)} s`} disabled={maximum <= minimum} onPreview={value => onPreview?.(value === null ? null : boundedTransitionRange(timeline, from, to, value, clip.id))} onCommit={duration => onChange({ duration })}/>
    {preset === 'spin-zoom' && <div className="transition-direction"><span>Direction</span><InspectorSelect label="Transition direction" value={clip.transition.direction} onChange={direction => onChange({ transition: { ...clip.transition!, direction } })} options={TRANSITION_DIRECTIONS.map(direction => ({ value: direction, label: directionLabels[direction] }))}/></div>}
    {(preset === 'gradient-wipe' || preset === 'iris-wipe') && <>
      <EffectSlider label="Softness" disabled={false} value={wipe.softness} bounds={[0,1]} step={.01} format={value => `${Math.round(value*100)}%`} onPreview={softness => onPreview?.(softness === null ? null : {transition:{...clip.transition!,softness}})} onCommit={softness => onChange({transition:{...clip.transition!,softness}})}/>
      {preset === 'gradient-wipe' ? <div className="transition-direction"><span>Direction</span><InspectorSelect label="Wipe direction" value={wipe.wipeDirection} onChange={wipeDirection => onChange({transition:{...clip.transition!,wipeDirection}})} options={WIPE_DIRECTIONS.map(value => ({value,label:wipeLabels[value]}))}/></div> : <>
        <div className="transition-direction"><span>Shape</span><InspectorSelect label="Iris shape" value={wipe.shape} onChange={shape => onChange({transition:{...clip.transition!,shape}})} options={IRIS_SHAPES.map(value => ({value,label:value === 'circle'?'Circle':'Ellipse'}))}/></div>
        {(['centerX','centerY'] as const).map(key => <EffectSlider key={key} disabled={false} label={key === 'centerX'?'Center X':'Center Y'} value={wipe[key]} bounds={[0,1]} step={.01} format={value => `${Math.round(value*100)}%`} onPreview={value => onPreview?.(value === null ? null : {transition:{...clip.transition!,[key]:value}})} onCommit={value => onChange({transition:{...clip.transition!,[key]:value}})}/>)}
      </>}
    </>}
  </section>;
}
