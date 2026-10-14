'use client';

import { lazy, Suspense, useState } from 'react';
import { selectedTextAnimation, textAnimationPatch, TEXT_ANIMATION_PRESETS, TEXT_ANIMATION_LABELS } from '@/lib/editor/text-effects';
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
const tabs = ['text', 'style', 'animation'] as const;
type TextSettingsTab = typeof tabs[number];

export function TextEffectsControls({ clip, onChange, onPreview, captionActions }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void; captionActions?: CaptionActions }) {
  const [tab, setTab] = useState<TextSettingsTab>('text');
  const animation = selectedTextAnimation(clip);
  return <div className="text-effects-controls" aria-label="Text settings">
    <TextFontStyles/>
    <header className="text-settings-heading"><h2>Text settings</h2><p title={clip.text}>{clip.kind === 'caption' ? 'Caption' : 'Graphic'} · {clip.text || 'Selected text'}</p></header>
    <div className="text-settings-tabs" role="tablist" aria-label="Text settings views" onKeyDown={event => {
      if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
      if (next === undefined) return;
      event.preventDefault(); setTab(tabs[next]);
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
    }}>{tabs.map(view => <button key={view} type="button" role="tab" id={`text-settings-${view}-tab`} aria-controls={`text-settings-${view}`} aria-selected={tab === view} tabIndex={tab === view ? 0 : -1} onClick={() => setTab(view)}>{view === 'text' ? 'Text' : view === 'style' ? 'Style' : 'Animation'}</button>)}</div>
    <div className={`text-settings-view text-settings-${tab}-view`} role="tabpanel" id={`text-settings-${tab}`} aria-labelledby={`text-settings-${tab}-tab`}>
    {tab === 'text' ? <>
      <TextEditingControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreview}/>
      {clip.kind === 'caption' && captionActions && <CaptionTimingControls clip={clip} actions={captionActions}/>}
      {clip.kind === 'caption' && captionActions && <ApplyCaptionStyle key={clip.id} actions={captionActions}/>}
    </> : tab === 'style' ? <>
      <TextStyleControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreview}/>
      <details className="text-style-group text-look-settings"><summary>Presets<span>Editable looks</span></summary><div className="text-style-body"><Suspense fallback={<p className="visual-control-note">Loading presets…</p>}><TextLookPicker selected={selectedTextLook(clip)} onSelect={look => onChange(textLookPatch(clip, look))}/></Suspense></div></details>
      {clip.kind === 'caption' && captionActions && <ApplyCaptionStyle key={clip.id} actions={captionActions}/>}
    </> : <>
      <div className="text-animation-current"><span>Applied</span><strong>{animation ? TEXT_ANIMATION_LABELS[animation] : 'Custom animation'}</strong></div>
      {clip.textTemplate && <label className="text-template-accent"><span>Accent color</span><ColorControl key={clip.id} label="Text accent color" value={clip.textTemplate.highlightColor ?? DEFAULT_TEXT_HIGHLIGHT} onCommit={highlightColor => onChange({ textTemplate: { ...clip.textTemplate!, highlightColor } })}/></label>}
      <div className="text-animation-cards"><Suspense fallback={<p className="visual-control-note">Loading animations…</p>}><TextPresetPicker presets={TEXT_ANIMATION_PRESETS} clip={clip} selected={animation} onSelect={preset => onChange(textAnimationPatch(clip, preset))}/></Suspense></div>
      <p className="text-animation-note">Preview first. Apply to this text when you’re ready.</p>
    </>}
    </div>
  </div>;
}
