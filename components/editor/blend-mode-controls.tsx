'use client';

import { BLEND_MODES, type BlendMode } from '@/lib/editor/clip-effects';
import './blend-mode-controls.css';

const labels: Record<BlendMode, string> = { normal: 'Normal', screen: 'Screen', multiply: 'Multiply', overlay: 'Overlay', 'plus-lighter': 'Add', difference: 'Difference' };
const descriptions: Record<BlendMode, string> = {
  normal: 'Show this clip over the layers below.', screen: 'Lighten the layers below; black becomes transparent.',
  multiply: 'Darken the layers below; white becomes transparent.', overlay: 'Combine contrast with the layers below.',
  'plus-lighter': 'Add this clip’s light to the layers below.', difference: 'Show the color difference from the layers below.',
};

export function BlendModeControls({ value, onChange, label = 'Blend mode' }: { value: BlendMode; onChange: (mode: BlendMode) => void; label?: string }) {
  return <div className="blend-mode-controls" role="group" aria-label={label}>
    {BLEND_MODES.map(mode => <button key={mode} type="button" data-blend-mode={mode} aria-pressed={value === mode} title={descriptions[mode]} onClick={() => { if (mode !== value) onChange(mode); }}>{labels[mode]}</button>)}
  </div>;
}
