'use client';

import { Button } from '@/components/ui/button';
import { selectedTextEffect, textEffectPatch, TEXT_EFFECT_LABELS, TEXT_EFFECT_PRESETS } from '@/lib/editor/text-effects';
import type { Clip } from '@/lib/editor/types';
import './text-effects-controls.css';

export function TextEffectsControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  const selected = selectedTextEffect(clip);
  return <div className="text-effects-controls">
    <div className="inspector-selection"><small>Text effects</small><p>{clip.text || 'Selected text'}</p></div>
    <div className="text-effect-presets" role="group" aria-label="Text animation">{TEXT_EFFECT_PRESETS.map(preset => <Button key={preset} variant="outline" aria-pressed={selected === preset} onClick={() => onChange(textEffectPatch(clip, preset))}>{TEXT_EFFECT_LABELS[preset]}</Button>)}</div>
    <p className="visual-control-note">Animates this text clip. Move or trim it on the timeline to change its timing.</p>
  </div>;
}
