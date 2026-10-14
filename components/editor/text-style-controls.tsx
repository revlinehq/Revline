'use client';

import { resolvedTextAppearance, TEXT_APPEARANCE_LIMITS, type TextAppearance } from '@/lib/editor/text-style';
import { BLEND_MODES } from '@/lib/editor/clip-effects';
import type { Clip } from '@/lib/editor/types';
import { EffectSlider } from './effect-slider';
import { ColorControl } from './color-control';
import { InspectorSelect } from './inspector-select';
import './text-style-controls.css';

export function TextStyleControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const style = resolvedTextAppearance(clip);
  const change = (patch: Partial<TextAppearance>) => onChange({ textStyle: { ...style, ...patch } });
  function slider(property: keyof typeof TEXT_APPEARANCE_LIMITS, label: string) {
    return <EffectSlider label={label} value={style[property]} bounds={TEXT_APPEARANCE_LIMITS[property]} step={1} format={value => `${Math.round(value)} px`} disabled={false} onPreview={value => onPreview?.(value === null ? null : { textStyle: { ...style, [property]: value } })} onCommit={value => change({ [property]: value })}/>;
  }
  function color(property: 'strokeColor' | 'shadowColor' | 'glowColor', label: string) {
    return <label className="text-style-color"><span>Color</span><ColorControl label={label} value={style[property]} onCommit={value => change({ [property]: value })}/></label>;
  }
  return <fieldset className="text-style-controls"><legend>Style</legend>
    <details className="text-style-group"><summary>Stroke<span>{style.strokeWidth ? `${style.strokeWidth} px` : 'Off'}</span></summary><div className="text-style-body">{slider('strokeWidth', 'Stroke width')}{color('strokeColor', 'Stroke color')}</div></details>
    <details className="text-style-group"><summary>Shadow<span>{style.shadowBlur || style.shadowX || style.shadowY ? 'On' : 'Off'}</span></summary><div className="text-style-body">{slider('shadowBlur', 'Shadow blur')}{color('shadowColor', 'Shadow color')}<div className="text-style-offsets">{slider('shadowX', 'Shadow X')}{slider('shadowY', 'Shadow Y')}</div></div></details>
    <details className="text-style-group"><summary>Glow<span>{style.glowBlur ? `${style.glowBlur} px` : 'Off'}</span></summary><div className="text-style-body">{slider('glowBlur', 'Glow blur')}{color('glowColor', 'Glow color')}</div></details>
    <div className="text-style-background"><label><input type="checkbox" aria-label="Text background" checked={!!clip.background && clip.background !== 'transparent'} onChange={event => onChange({ background: event.target.checked ? '#0B0C0E' : 'transparent' })}/>Background</label>{clip.background && clip.background !== 'transparent' && <ColorControl label="Text background color" value={clip.background} onCommit={background => onChange({ background })}/>}</div>
    <details className="text-style-group"><summary>Compositing<span>{clip.blendMode ?? 'normal'}</span></summary><div className="text-style-body"><InspectorSelect label="Text blend mode" value={clip.blendMode ?? 'normal'} onChange={blendMode => onChange({ blendMode })} options={BLEND_MODES.map(mode => ({ value: mode, label: mode === 'plus-lighter' ? 'Add' : mode.charAt(0).toUpperCase() + mode.slice(1) }))}/></div></details>
  </fieldset>;
}
