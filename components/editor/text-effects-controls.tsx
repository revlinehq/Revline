'use client';

import { Button } from '@/components/ui/button';
import { lazy, Suspense } from 'react';
import { selectedTextEffect, textEffectPatch, textTemplatePatch, TEXT_EFFECT_LABELS, TEXT_EFFECT_PRESETS } from '@/lib/editor/text-effects';
import { REMOTION_TEXT_PRESETS, VFX_TEXT_APPEARANCE } from '@/lib/editor/remotion-text';
import type { Clip } from '@/lib/editor/types';
import { TextEditingControls } from './text-editing-controls';
import { ColorControl } from './color-control';
import { SubtitleStylePicker } from './subtitle-style-picker';
import { selectedSubtitleStyle, subtitleStylePatch } from '@/lib/editor/subtitle-styles';
import './text-effects-controls.css';

const TextPresetPicker = lazy(() => import('./text-preset-picker'));

export function TextEffectsControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  const selected = selectedTextEffect(clip);
  const appearance=clip.textTemplate?VFX_TEXT_APPEARANCE[clip.textTemplate.preset]:undefined;
  return <div className="text-effects-controls">
    <TextEditingControls clip={clip} onChange={onChange}/>
    {clip.kind === 'caption' && <SubtitleStylePicker selected={selectedSubtitleStyle(clip)} onSelect={style => onChange(subtitleStylePatch(style))}/>}
    <Suspense fallback={<p className="visual-control-note">Loading text templates…</p>}><TextPresetPicker presets={REMOTION_TEXT_PRESETS} selected={clip.textTemplate?.preset} onSelect={preset => onChange(textTemplatePatch(clip, preset))}/></Suspense>
    {appearance&&clip.textTemplate&&<label className="text-template-accent"><span>{clip.textTemplate.preset==='kinetic-stack'?'Accent':'Outline'}</span><ColorControl key={clip.id} label={clip.textTemplate.preset==='kinetic-stack'?'Text accent color':'Text outline color'} value={clip.textTemplate.highlightColor??appearance.highlightColor} onCommit={highlightColor=>onChange({textTemplate:{...clip.textTemplate!,highlightColor}})}/></label>}
    {clip.textTemplate?.preset === 'karaoke' && <p className="visual-control-note">Highlights words across this clip’s duration.</p>}
    {clip.textTemplate && <Button variant="outline" onClick={() => onChange({textTemplate:undefined})}>Remove text effect</Button>}
    <fieldset className="text-entrance"><legend>Entrance &amp; exit</legend><div className="text-effect-presets" role="group" aria-label="Text animation">{TEXT_EFFECT_PRESETS.map(preset => <Button key={preset} variant="outline" aria-pressed={selected === preset} onClick={() => onChange(textEffectPatch(clip, preset))}>{TEXT_EFFECT_LABELS[preset]}</Button>)}</div></fieldset>
    <p className="visual-control-note">Combine a text effect with an entrance. None removes only the entrance.</p>
  </div>;
}
