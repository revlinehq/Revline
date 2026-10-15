'use client';

import type { Clip } from '@/lib/editor/types';
import { DEFAULT_SOLID_COLOR, SOLID_COLOR_LIMITS, solidColorSettings, type SolidColorSettings } from '@/lib/editor/clip-effects';
import { ColorControl } from './color-control';
import { EffectSlider } from './effect-slider';

export function SolidColorControls({ clip, onChange, onPreview, onConvert }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void; onConvert?:()=>void }) {
  const settings = solidColorSettings(clip);
  const patch = (key: keyof SolidColorSettings, value: string | number): Partial<Clip> => ({ solidColor: { ...settings, [key]: value } });
  return <div className="visual-effects-controls" aria-label="Solid color rectangle settings">
    <div className="inspector-selection"><small>{clip.kind==='solid'?'Visual layer':'Effect'}</small><p>Solid color</p></div>
    {clip.kind==='effect'&&onConvert&&<button type="button" className="effect-color-reset" aria-label="Move solid color to visual layer" onClick={onConvert}>Move to visual layer</button>}
    <fieldset className="dither-colors"><label>Color<ColorControl label="Rectangle color" value={settings.color} onCommit={color => onChange(patch('color', color))}/></label></fieldset>
    {([['width', 'Width'], ['height', 'Height'], ['x', 'Position X'], ['y', 'Position Y'], ['opacity', 'Opacity']] as const).map(([key, label]) => <EffectSlider key={key} label={label} value={settings[key]} bounds={SOLID_COLOR_LIMITS[key]} format={value => `${Math.round(value * 100)}%`} disabled={false} onPreview={value => onPreview?.(value === null ? null : patch(key, value))} onCommit={value => onChange(patch(key, value))}/>)}
    <button type="button" className="effect-color-reset" onClick={() => onChange({ solidColor: { ...DEFAULT_SOLID_COLOR, color: settings.color } })}>Fill frame</button>
    <p className="visual-control-note">{clip.kind==='solid'?'Drag this layer below footage for a background, or above it for an overlay. Trim its timeline edges to choose when it appears.':'Move this saved effect to a visual layer to place it behind footage.'}</p>
  </div>;
}
