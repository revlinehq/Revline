'use client';

import { Plus, X } from 'lucide-react';
import { DEFAULT_TEXT_GRADIENT, type TextGradient } from '@/lib/editor/text-gradient';
import type { Clip } from '@/lib/editor/types';
import { ColorControl } from './color-control';
import { EffectSlider } from './effect-slider';
import { InspectorSelect } from './inspector-select';

export function TextGradientControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const gradient = clip.textGradient ?? DEFAULT_TEXT_GRADIENT;
  const change = (patch: Partial<TextGradient>) => onChange({ textGradient: { ...gradient, ...patch } });
  const animation = gradient.animation;
  return <details className="text-style-group" open={!!clip.textGradient || undefined}>
    <summary>Gradient<span>{clip.textGradient ? animation ? 'Animated' : 'Static' : 'Off'}</span></summary>
    <div className="text-style-body text-gradient-controls">
      <label className="text-gradient-toggle"><span>Gradient fill</span><input type="checkbox" checked={!!clip.textGradient} onChange={event => onChange({ textGradient: event.target.checked ? { ...DEFAULT_TEXT_GRADIENT, colors: [...DEFAULT_TEXT_GRADIENT.colors] } : undefined })}/></label>
      {clip.textGradient && <>
        <div className="text-gradient-swatch" aria-hidden="true" style={{ background: `linear-gradient(${gradient.angle}deg,${gradient.colors.join(',')})` }}/>
        {gradient.colors.map((color, index) => <div className="text-gradient-stop" key={index}><span>Color {index + 1}</span><ColorControl label={`Gradient color ${index + 1}`} value={color} onCommit={value => change({ colors: gradient.colors.map((previous, i) => i === index ? value : previous) })}/>{gradient.colors.length > 2 && <button type="button" aria-label={`Remove gradient color ${index + 1}`} onClick={() => change({ colors: gradient.colors.filter((_, i) => i !== index) })}><X size={12}/></button>}</div>)}
        {gradient.colors.length < 5 && <button type="button" className="text-gradient-add" onClick={() => change({ colors: [...gradient.colors, '#FFFFFF'] })}><Plus size={12}/>Add color</button>}
        <EffectSlider label="Gradient angle" value={gradient.angle} bounds={[0, 360]} step={1} format={value => `${Math.round(value)}°`} disabled={false} onPreview={angle => onPreview?.(angle === null ? null : { textGradient: { ...gradient, angle } })} onCommit={angle => change({ angle })}/>
        <label className="text-gradient-toggle"><span>Animate colors</span><input type="checkbox" checked={!!animation} onChange={event => change({ offset: 0, animation: event.target.checked ? { duration: 3, direction: 'forward', loop: true } : undefined })}/></label>
        {animation && <>
          <EffectSlider label="Time per pass" value={animation.duration} bounds={[.2, 60]} step={.1} format={value => `${value.toFixed(1)}s`} disabled={false} onPreview={duration => onPreview?.(duration === null ? null : { textGradient: { ...gradient, offset: 0, animation: { ...animation, duration } } })} onCommit={duration => change({ offset: 0, animation: { ...animation, duration } })}/>
          <InspectorSelect label="Gradient direction" value={animation.direction} options={[{ value: 'forward', label: 'Forward' }, { value: 'reverse', label: 'Reverse' }]} onChange={direction => change({ offset: 0, animation: { ...animation, direction } })}/>
          <label className="text-gradient-toggle"><span>Loop back and forth</span><input type="checkbox" checked={animation.loop} onChange={event => change({ offset: 0, animation: { ...animation, loop: event.target.checked } })}/></label>
        </>}
      </>}
    </div>
  </details>;
}
