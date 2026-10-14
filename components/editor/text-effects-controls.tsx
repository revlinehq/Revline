'use client';

import { lazy, Suspense } from 'react';
import { selectedTextAnimation, textAnimationPatch, TEXT_ANIMATION_PRESETS } from '@/lib/editor/text-effects';
import { DEFAULT_TEXT_HIGHLIGHT } from '@/lib/editor/remotion-text';
import { selectedTextLook, textLookPatch } from '@/lib/editor/text-looks';
import type { Clip } from '@/lib/editor/types';
import { TextEditingControls } from './text-editing-controls';
import { TextStyleControls } from './text-style-controls';
import { CaptionTimingControls, ApplyCaptionStyle, type CaptionActions } from './caption-controls';
import { ColorControl } from './color-control';
import { TextFontStyles } from './text-font-styles';
import './text-effects-controls.css';

const TextPresetPicker = lazy(() => import('./text-preset-picker'));
const TextLookPicker = lazy(() => import('./text-look-picker').then(module => ({ default: module.TextLookPicker })));

export function TextEffectsControls({ clip, onChange, onPreview, captionActions }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void; captionActions?: CaptionActions }) {
  return <div className="text-effects-controls">
    <TextFontStyles/>
    <TextEditingControls clip={clip} onChange={onChange} onPreview={onPreview}/>
    {clip.kind === 'caption' && captionActions && <CaptionTimingControls clip={clip} actions={captionActions}/>}
    <TextStyleControls clip={clip} onChange={onChange} onPreview={onPreview}/>
    {clip.kind === 'caption' && captionActions && <ApplyCaptionStyle key={clip.id} actions={captionActions}/>}
    <fieldset className="text-animation-controls"><legend>Animation</legend>
      <Suspense fallback={<p className="visual-control-note">Loading animations…</p>}><TextPresetPicker presets={TEXT_ANIMATION_PRESETS} clip={clip} selected={selectedTextAnimation(clip)} onSelect={preset => onChange(textAnimationPatch(clip, preset))}/></Suspense>
      {clip.textTemplate && <label className="text-template-accent"><span>Accent color</span><ColorControl key={clip.id} label="Text accent color" value={clip.textTemplate.highlightColor ?? DEFAULT_TEXT_HIGHLIGHT} onCommit={highlightColor => onChange({ textTemplate: { ...clip.textTemplate!, highlightColor } })}/></label>}
    </fieldset>
    <details className="text-style-group text-look-settings"><summary>Presets<span>Editable looks</span></summary><div className="text-style-body"><Suspense fallback={<p className="visual-control-note">Loading presets…</p>}><TextLookPicker selected={selectedTextLook(clip)} onSelect={look => onChange(textLookPatch(clip, look))}/></Suspense></div></details>
  </div>;
}
