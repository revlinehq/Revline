'use client';

import type { Clip } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import { EffectSlider } from './visual-effects-controls';
import { ColorControl } from './color-control';
import './text-editing-controls.css';

/** The same words and appearance controls stay available in Edit and Text effects. */
export function TextEditingControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  return <div className="text-editing-controls">
    <label className="inspector-field">Words<textarea aria-label="Selected text" value={clip.text ?? ''} maxLength={2000} onChange={event => onChange({ text: event.currentTarget.value })}/></label>
    <div className="text-size-controls">
      <EffectSlider label="Text size" value={clip.fontSize ?? (clip.kind === 'graphic' ? 92 : 52)} bounds={[8,300]} step={1} format={value=>`${Math.round(value)} px`} disabled={false} onPreview={()=>{}} onCommit={fontSize=>onChange({fontSize})}/>
      <NumberControl label="Custom text size" min={8} max={300} value={clip.fontSize ?? (clip.kind === 'graphic' ? 92 : 52)} onCommit={fontSize=>onChange({fontSize})}/>
    </div>
    <div className="inspector-field-row">
      <label className="inspector-field">Color<ColorControl key={clip.id} label="Text color" value={clip.color ?? '#ffffff'} onCommit={color => onChange({ color })}/></label>
    </div>
  </div>;
}
