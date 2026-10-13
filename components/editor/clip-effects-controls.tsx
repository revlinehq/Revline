'use client';

import { Button } from '@/components/ui/button';
import { BLEND_MODES, MOTION_PRESETS, motionPreset } from '@/lib/editor/clip-effects';
import type { Clip } from '@/lib/editor/types';
import './clip-effects-controls.css';

const labels = { none: 'None', fade: 'Fade in / out', punch: 'Punch zoom', shake: 'Impact shake', flash: 'Flash', pop: 'Pop in' };
const blends = { normal: 'Normal', screen: 'Screen', multiply: 'Multiply', overlay: 'Overlay', 'plus-lighter': 'Add light' };

export function ClipEffectsControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  const text = clip.kind === 'caption' || clip.kind === 'graphic';
  return <div className="clip-effects-controls">
    <div className="inspector-selection"><small>{text ? 'Text effects' : 'Visual effects'}</small><p>{clip.text || 'Selected clip'}</p></div>
    <fieldset><legend>Motion</legend><div className="clip-motion-presets">{MOTION_PRESETS.map(preset => <Button key={preset} variant="outline" onClick={() => onChange(motionPreset(clip, preset))}>{labels[preset]}</Button>)}</div></fieldset>
    <p className="visual-control-note">Apply a motion preset, or describe the timing in chat. Undo restores the previous effect.</p>
    {text && <Button variant="outline" onClick={() => onChange({ animation: 'rise', motion: [], motionOffset: 0 })}>Rise in</Button>}
    <label className="inspector-field">Blend mode<select aria-label="Blend mode" value={clip.blendMode ?? 'normal'} onChange={event => onChange({ blendMode: event.target.value as Clip['blendMode'] })}>{BLEND_MODES.map(mode => <option key={mode} value={mode}>{blends[mode]}</option>)}</select></label>
    <p className="visual-control-note">Place an overlay on a higher V track. Screen combines light effects with the footage below.</p>
  </div>;
}
