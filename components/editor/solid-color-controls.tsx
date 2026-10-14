'use client';

import type { Clip } from '@/lib/editor/types';
import { DEFAULT_SOLID_COLOR, SOLID_COLOR_LIMITS, solidColorSettings, type SolidColorSettings } from '@/lib/editor/clip-effects';
import { ColorControl } from './color-control';
import { EffectSlider } from './visual-effects-controls';

export function SolidColorControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const settings = solidColorSettings(clip);
  const patch = (key: keyof SolidColorSettings, value: string | number): Partial<Clip> => ({ solidColor: { ...settings, [key]: value } });
  return <div className="visual-effects-controls" aria-label="Solid color rectangle settings">
    <div className="inspector-selection"><small>Effect</small><p>Solid color</p></div>
    <fieldset className="dither-colors"><label>Color<ColorControl label="Rectangle color" value={settings.color} onCommit={color => onChange(patch('color', color))}/></label></fieldset>
    {([['width', 'Width'], ['height', 'Height'], ['x', 'Position X'], ['y', 'Position Y'], ['opacity', 'Opacity']] as const).map(([key, label]) => <EffectSlider key={key} label={label} value={settings[key]} bounds={SOLID_COLOR_LIMITS[key]} format={value => `${Math.round(value * 100)}%`} disabled={false} onPreview={value => onPreview?.(value === null ? null : patch(key, value))} onCommit={value => onChange(patch(key, value))}/>)}
    <button type="button" className="effect-color-reset" onClick={() => onChange({ solidColor: { ...DEFAULT_SOLID_COLOR, color: settings.color } })}>Fill frame</button>
    <p className="visual-control-note">Move or stretch this effect on the timeline to choose when the rectangle appears.</p>
  </div>;
}
