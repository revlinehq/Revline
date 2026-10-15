'use client';

import { lazy, Suspense, useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { selectedTextAnimation, textAnimationPatch, TEXT_ANIMATION_PRESETS, TEXT_ANIMATION_LABELS } from '@/lib/editor/text-effects';
import { DEFAULT_TEXT_HIGHLIGHT, EXPRESSIVE_TEXT_DEFAULTS, EXPRESSIVE_TEXT_LIMITS, EXPRESSIVE_TEXT_PRESETS } from '@/lib/editor/remotion-text';
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
  return <Tabs value={tab} onValueChange={value=>setTab(value as TextSettingsTab)} className="text-effects-controls" aria-label="Text settings">
    <TextFontStyles/>
    <header className="text-settings-heading"><h2>Text settings</h2><p title={clip.text}>{clip.kind === 'caption' ? 'Caption' : 'Graphic'} · {clip.text || 'Selected text'}</p></header>
    <TabsList className="text-settings-tabs" aria-label="Text settings views">{tabs.map(view => <TabsTrigger key={view} value={view} id={`text-settings-${view}-tab`} aria-controls={`text-settings-${view}`}>{view === 'text' ? 'Text' : view === 'style' ? 'Style' : 'Animation'}</TabsTrigger>)}</TabsList>
    <TabsContent value={tab} className="text-settings-view" data-text-view={tab} id={`text-settings-${tab}`} aria-labelledby={`text-settings-${tab}-tab`}>
    {tab === 'text' ? <>
      <TextEditingControls key={`text-${clip.id}`} clip={clip} onChange={onChange} onPreview={onPreview}/>
      {clip.kind === 'caption' && captionActions && <CaptionTimingControls clip={clip} actions={captionActions}/>}
      {clip.kind === 'caption' && captionActions && <ApplyCaptionStyle key={`apply-text-${clip.id}`} actions={captionActions}/>}
    </> : tab === 'style' ? <>
      <TextStyleControls key={`style-${clip.id}`} clip={clip} onChange={onChange} onPreview={onPreview}/>
      <details className="text-style-group text-look-settings"><summary>Presets<span>Editable looks</span></summary><div className="text-style-body"><Suspense fallback={<p className="visual-control-note">Loading presets…</p>}><TextLookPicker selected={selectedTextLook(clip)} onSelect={look => onChange(textLookPatch(clip, look))}/></Suspense></div></details>
      {clip.kind === 'caption' && captionActions && <ApplyCaptionStyle key={`apply-style-${clip.id}`} actions={captionActions}/>}
    </> : <>
      <div className="text-animation-current"><span>Applied</span><strong>{animation ? TEXT_ANIMATION_LABELS[animation] : 'Custom animation'}</strong></div>
      {clip.textTemplate && <label className="text-template-accent"><span>Accent color</span><ColorControl key={clip.id} label="Text accent color" value={clip.textTemplate.highlightColor ?? DEFAULT_TEXT_HIGHLIGHT} onCommit={highlightColor => onChange({ textTemplate: { ...clip.textTemplate!, highlightColor } })}/></label>}
      {clip.textTemplate && EXPRESSIVE_TEXT_PRESETS.some(preset=>preset===clip.textTemplate!.preset) && <div className="text-animation-tuning">{([
        ['strength','Animation strength',.1,'×'],['revealDuration','Reveal duration',.05,'s'],['stagger','Text stagger',.01,'s'],
      ] as const).map(([key,label,step,unit])=><label key={key}><span>{label}<output>{clip.textTemplate![key]??EXPRESSIVE_TEXT_DEFAULTS[key]}{unit}</output></span><input type="range" aria-label={label} min={EXPRESSIVE_TEXT_LIMITS[key][0]} max={EXPRESSIVE_TEXT_LIMITS[key][1]} step={step} value={clip.textTemplate![key]??EXPRESSIVE_TEXT_DEFAULTS[key]} onChange={event=>onChange({textTemplate:{...clip.textTemplate!,[key]:Number(event.target.value)}})}/></label>)}<p>Word effects use a word stagger; scramble uses a character stagger. Line breaks stay fixed.</p></div>}
      <div className="text-animation-cards"><Suspense fallback={<p className="visual-control-note">Loading animations…</p>}><TextPresetPicker presets={TEXT_ANIMATION_PRESETS} clip={clip} selected={animation} onSelect={preset => onChange(textAnimationPatch(clip, preset))}/></Suspense></div>
      <p className="text-animation-note">Preview first. Apply to this text when you’re ready.</p>
    </>}
    </TabsContent>
  </Tabs>;
}
