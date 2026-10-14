'use client';

import { resolvedTextAppearance, TEXT_APPEARANCE_LIMITS, type TextAppearance } from '@/lib/editor/text-style';
import type { Clip } from '@/lib/editor/types';
import { EffectSlider } from './effect-slider';
import { ColorControl } from './color-control';
import { BlendModeControls } from './blend-mode-controls';
import './text-style-controls.css';

export function TextStyleControls({ clip, onChange, onPreview }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void }) {
  const style = resolvedTextAppearance(clip);
  const change = (patch: Partial<TextAppearance>) => onChange({ textStyle: { ...style, ...patch } });
  function slider(property: keyof typeof TEXT_APPEARANCE_LIMITS, label: string) {
    return <EffectSlider label={label} value={style[property]} bounds={TEXT_APPEARANCE_LIMITS[property]} step={1} format={value => `${Math.round(value)} px`} disabled={false} onPreview={value => onPreview?.(value === null ? null : { textStyle: { ...style, [property]: value } })} onCommit={value => change({ [property]: value })}/>;
  }
  function color(property: 'strokeColor' | 'shadowColor' | 'glowColor', label: string) {
    return <label className="text-style-color"><ColorControl label={label} value={style[property]} onCommit={value => change({ [property]: value })}/><span>{style[property].toUpperCase()}</span></label>;
  }
  return <fieldset className="text-style-controls" aria-label="Text style">
    <details className="text-style-group" open={style.strokeWidth > 0 || undefined}><summary>Stroke<span>{style.strokeWidth ? `${style.strokeWidth} px` : 'Off'}</span></summary><div className="text-style-body">{slider('strokeWidth', 'Stroke width')}{color('strokeColor', 'Stroke color')}</div></details>
    <details className="text-style-group"><summary>Shadow<span>{style.shadowBlur || style.shadowX || style.shadowY ? 'On' : 'Off'}</span></summary><div className="text-style-body">{slider('shadowBlur', 'Shadow blur')}{color('shadowColor', 'Shadow color')}<div className="text-style-offsets">{slider('shadowX', 'Shadow X')}{slider('shadowY', 'Shadow Y')}</div></div></details>
    <details className="text-style-group" open={style.glowBlur > 0 || undefined}><summary>Glow<span>{style.glowBlur ? `${style.glowBlur} px` : 'Off'}</span></summary><div className="text-style-body">{slider('glowBlur', 'Glow blur')}{color('glowColor', 'Glow color')}</div></details>
    <section className="text-style-compositing" aria-label="Text compositing"><h3>Compositing</h3><BlendModeControls label="Text blend mode" value={clip.blendMode ?? 'normal'} onChange={blendMode => onChange({ blendMode })}/></section>
  </fieldset>;
}
