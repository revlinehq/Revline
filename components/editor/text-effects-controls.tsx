'use client';

import { Button } from '@/components/ui/button';
import { lazy, Suspense } from 'react';
import { selectedTextEffect, textEffectPatch, textTemplatePatch, TEXT_EFFECT_LABELS, TEXT_EFFECT_PRESETS } from '@/lib/editor/text-effects';
import { REMOTION_TEXT_PRESETS, VFX_TEXT_APPEARANCE } from '@/lib/editor/remotion-text';
import type { Clip } from '@/lib/editor/types';
import { TextEditingControls } from './text-editing-controls';
import './text-effects-controls.css';

const TextPresetPicker = lazy(() => import('./text-preset-picker'));
const colorInput=(value:string)=>/^#[\da-f]{3,4}$/i.test(value)?`#${value.slice(1,4).split('').map(char=>char+char).join('')}`:value.slice(0,7);

export function TextEffectsControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  const selected = selectedTextEffect(clip);
  const appearance=clip.textTemplate?VFX_TEXT_APPEARANCE[clip.textTemplate.preset]:undefined;
  return <div className="text-effects-controls">
    <TextEditingControls clip={clip} onChange={onChange}/>
    <Suspense fallback={<p className="visual-control-note">Loading text templates…</p>}><TextPresetPicker presets={REMOTION_TEXT_PRESETS} selected={clip.textTemplate?.preset} onSelect={preset => onChange(textTemplatePatch(clip, preset))}/></Suspense>
    {appearance&&clip.textTemplate&&<label className="text-template-accent"><span>{clip.textTemplate.preset==='kinetic-stack'?'Accent':'Outline'}</span><input type="color" aria-label={clip.textTemplate.preset==='kinetic-stack'?'Text accent color':'Text outline color'} value={colorInput(clip.textTemplate.highlightColor??appearance.highlightColor)} onChange={event=>onChange({textTemplate:{...clip.textTemplate!,highlightColor:event.currentTarget.value}})}/></label>}
    {clip.textTemplate?.preset === 'karaoke' && <p className="visual-control-note">Highlights words across this clip’s duration.</p>}
    <div className="text-effect-presets" role="group" aria-label="Text animation">{TEXT_EFFECT_PRESETS.map(preset => <Button key={preset} variant="outline" aria-pressed={selected === preset} onClick={() => onChange(textEffectPatch(clip, preset))}>{TEXT_EFFECT_LABELS[preset]}</Button>)}</div>
    <p className="visual-control-note">Apply to this text. Move or trim its clip to choose when it appears.</p>
  </div>;
}
