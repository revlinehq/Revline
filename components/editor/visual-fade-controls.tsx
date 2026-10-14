'use client';

import type { Clip } from '@/lib/editor/types';
import { visualFadeSettings } from '@/lib/editor/visual-fades';
import { EffectSlider } from './visual-effects-controls';
import './audio-controls.css';

export function VisualFadeControls({ clip, fps = 30, onChange, onPreview }: {
  clip: Clip; fps?: number; onChange(patch: Partial<Clip>): void;
  onPreview?(patch: Partial<Clip> | null): void;
}) {
  if (clip.kind !== 'video' && clip.kind !== 'image') return null;
  const settings = visualFadeSettings(clip);
  const patch = (key: 'fadeIn' | 'fadeOut', value: number): Partial<Clip> => ({ visualFade: { ...settings, [key]: value }, visualFadeTiming: undefined });
  return <div className="visual-fade-controls audio-controls" aria-label="Visual fades"><fieldset><legend>Fades</legend>
    {(['fadeIn', 'fadeOut'] as const).map(key => {
      const maximum = Math.max(0, clip.duration - settings[key === 'fadeIn' ? 'fadeOut' : 'fadeIn']);
      return <EffectSlider key={key} label={key === 'fadeIn' ? 'Fade in' : 'Fade out'} value={settings[key]} bounds={[0, maximum]} step={1 / fps}
        format={value => `${Number(value.toFixed(2))} s`} disabled={maximum <= 0}
        onPreview={value => onPreview?.(value === null ? null : patch(key, value))}
        onCommit={value => onChange(patch(key, value))}/>;
    })}
  </fieldset></div>;
}
