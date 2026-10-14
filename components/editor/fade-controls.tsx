'use client';

import type { VisualFadeSettings } from '@/lib/editor/visual-fades';
import { EffectSlider } from './effect-slider';

/** Audio and footage share appearance and gestures; callers own their different fade limits. */
export function FadeControls({ settings, maximum, fps, onChange, onPreview }: {
  settings: VisualFadeSettings; maximum: VisualFadeSettings; fps: number;
  onChange(patch: Partial<VisualFadeSettings>): void;
  onPreview(patch: Partial<VisualFadeSettings> | null): void;
}) {
  return <fieldset><legend>Fades</legend>{(['fadeIn', 'fadeOut'] as const).map(key =>
    <EffectSlider key={key} label={key === 'fadeIn' ? 'Fade in' : 'Fade out'} value={settings[key]} bounds={[0, maximum[key]]}
      step={1 / fps} format={value => `${Number(value.toFixed(2))} s`} disabled={maximum[key] <= 0}
      onPreview={value => onPreview(value === null ? null : { [key]: value })}
      onCommit={value => onChange({ [key]: value })}/>
  )}</fieldset>;
}
