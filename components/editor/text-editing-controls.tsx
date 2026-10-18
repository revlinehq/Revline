'use client';

import { DEFAULT_TRANSFORM, type Clip } from '@/lib/editor/types';
import { AlignHorizontalJustifyStart, AlignHorizontalJustifyCenter, AlignHorizontalJustifyEnd } from 'lucide-react';
import { NumberControl } from './visual-controls';
import { EffectSlider } from './effect-slider';
import { ColorControl } from './color-control';
import { TEXT_FONTS, editorTextFont } from '@/lib/editor/text-fonts';
import { textStyle } from '@/lib/editor/text-style';
import { InspectorSelect } from './inspector-select';
import './text-editing-controls.css';

/** Text fields commit through the same clip operations as the preview. */
export function TextEditingControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const background = !!clip.background && clip.background !== 'transparent';
  const { fontSize, x, y } = textStyle(clip);
  return <div className="text-editing-controls">
    <label className="inspector-field">Words<textarea aria-label="Selected text" value={clip.text ?? ''} maxLength={2000} onChange={event => onChange({ text: event.currentTarget.value })}/></label>
    <div className="inspector-field"><span>Font</span><InspectorSelect label="Text font" value={clip.fontFamily ?? 'space-grotesk'} onChange={fontFamily => onChange({ fontFamily })} options={TEXT_FONTS.map(font => ({ value: font.id, label: font.label, style: { fontFamily: editorTextFont(font.id).family, fontWeight: font.weight } }))}/></div>
    <div className="text-size-controls">
      <EffectSlider label="Text size" value={fontSize} bounds={[8,300]} step={1} format={value=>`${Math.round(value)} px`} disabled={false} onPreview={value => onPreview?.(value === null ? null : { fontSize: value })} onCommit={fontSize=>onChange({fontSize})}/>
      <NumberControl label="Custom text size" min={8} max={300} value={fontSize} onCommit={fontSize=>onChange({fontSize})}/>
    </div>
    <div className="inspector-field"><span>Fill</span><ColorControl key={clip.id} label="Text color" value={clip.color ?? '#ffffff'} onCommit={color => onChange({ color })}/></div>
    <div className="inspector-field"><span>Background</span><InspectorSelect label="Text background" value={background ? 'solid' : 'none'} options={[{value:'none',label:'No fill'},{value:'solid',label:'Solid color'}]} onChange={value => onChange({background:value === 'solid' ? '#0B0C0E' : 'transparent'})}/>{background && <ColorControl label="Text background color" value={clip.background!} onCommit={background => onChange({ background })}/>}</div>
    <div className="inspector-field"><span>Position</span><div className="text-position-controls" role="group" aria-label="Text position">{([{label:'Left',x:.25,Icon:AlignHorizontalJustifyStart},{label:'Center',x:.5,Icon:AlignHorizontalJustifyCenter},{label:'Right',x:.75,Icon:AlignHorizontalJustifyEnd}] as const).map(({label,x,Icon}) => <button key={label} type="button" aria-label={`Position text ${label.toLowerCase()}`} aria-pressed={(clip.x ?? .5) === x} title={`Position at ${x * 100}% of the frame`} onClick={() => onChange({ x })}><Icon size={14} strokeWidth={1.5}/></button>)}</div></div>
    <details className="text-style-group text-transform-controls"><summary>Transform</summary><div className="text-style-body"><div className="text-transform-position"><NumberControl label="Text X" value={x * 100} min={0} max={100} step={1} unit="%" onCommit={x => onChange({ x:x / 100 })}/><NumberControl label="Text Y" value={y * 100} min={0} max={100} step={1} unit="%" onCommit={y => onChange({ y:y / 100 })}/></div><NumberControl label="Text rotation" value={clip.transform?.rotation ?? 0} min={-360} max={360} unit="°" onCommit={rotation => onChange({ transform:{...DEFAULT_TRANSFORM,...clip.transform,rotation} })}/></div></details>
  </div>;
}
