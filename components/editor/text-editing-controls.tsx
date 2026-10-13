'use client';

import { DEFAULT_TRANSFORM, type Clip } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import './text-editing-controls.css';

/** The same words and appearance controls stay available in Edit and Text effects. */
export function TextEditingControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  return <div className="text-editing-controls">
    <label className="inspector-field">Words<textarea aria-label="Selected text" value={clip.text ?? ''} maxLength={2000} onChange={event => onChange({ text: event.currentTarget.value })}/></label>
    <div className="inspector-field-row">
      <NumberControl label="Text size" min={8} max={300} value={clip.fontSize ?? (clip.kind === 'graphic' ? 92 : 52)} onCommit={fontSize => onChange({ fontSize })}/>
      <label className="inspector-field">Color<input aria-label="Text color" type="color" value={clip.color ?? '#ffffff'} onChange={event => onChange({ color: event.currentTarget.value })}/></label>
    </div>
    <NumberControl label="Text rotation" min={-360} max={360} value={clip.transform?.rotation ?? 0} unit="°" onCommit={rotation => onChange({ transform: { ...DEFAULT_TRANSFORM, rotation } })}/>
  </div>;
}
