'use client';

import type { Clip } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import { EffectSlider } from './visual-effects-controls';
import { ColorControl } from './color-control';
import { TEXT_FONTS } from '@/lib/editor/text-fonts';
import { InspectorSelect } from './inspector-select';
import './text-editing-controls.css';

/** Words and appearance share the text editor with templates and animation. */
export function TextEditingControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  return <div className="text-editing-controls">
    <label className="inspector-field">Words<textarea aria-label="Selected text" value={clip.text ?? ''} maxLength={2000} onChange={event => onChange({ text: event.currentTarget.value })}/></label>
    <div className="inspector-field"><span>Font</span><InspectorSelect label="Text font" value={clip.fontFamily ?? 'space-grotesk'} onChange={fontFamily => onChange({ fontFamily })} options={TEXT_FONTS.map(font => ({ value: font.id, label: font.label, style: { fontFamily: font.family, fontWeight: font.weight } }))}/></div>
    <div className="text-size-controls">
      <EffectSlider label="Text size" value={clip.fontSize ?? (clip.kind === 'graphic' ? 92 : 52)} bounds={[8,300]} step={1} format={value=>`${Math.round(value)} px`} disabled={false} onPreview={value => onPreview?.(value === null ? null : { fontSize: value })} onCommit={fontSize=>onChange({fontSize})}/>
      <NumberControl label="Custom text size" min={8} max={300} value={clip.fontSize ?? (clip.kind === 'graphic' ? 92 : 52)} onCommit={fontSize=>onChange({fontSize})}/>
    </div>
    <label className="text-color-control"><span>Color</span><ColorControl key={clip.id} label="Text color" value={clip.color ?? '#ffffff'} onCommit={color => onChange({ color })}/></label>
  </div>;
}
