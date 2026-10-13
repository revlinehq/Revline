'use client';

import { Button } from '@/components/ui/button';
import { selectedTextEffect, textEffectPatch, textTemplatePatch, TEXT_EFFECT_LABELS, TEXT_EFFECT_PRESETS } from '@/lib/editor/text-effects';
import { REMOTION_TEXT_PRESETS, REMOTION_TEXT_LABELS, type RemotionTextPreset } from '@/lib/editor/remotion-text';
import type { Clip } from '@/lib/editor/types';
import './text-effects-controls.css';

export function TextTemplatePreview({ preset }: { preset: RemotionTextPreset }) {
  return <span className={`text-template-preview text-template-${preset}`} aria-hidden="true">{preset === 'word-reveal' ? <><b>YOUR</b><small>NEXT IDEA</small></> : preset === 'word-pop' ? <><b>MAKE</b><small>IT MOVE</small></> : preset === 'slide-title' ? <><b>YOUR NEXT</b><small>IDEA →</small></> : <><b>THIS IS</b><small><mark>YOUR</mark> MOMENT</small></>}</span>;
}

export function TextEffectsControls({ clip, onChange }: { clip: Clip; onChange: (patch: Partial<Clip>) => void }) {
  const selected = selectedTextEffect(clip);
  return <div className="text-effects-controls">
    <div className="inspector-selection"><small>Text effects</small><p>{clip.text || 'Selected text'}</p></div>
    <div className="text-template-presets" role="group" aria-label="Text templates">{REMOTION_TEXT_PRESETS.map(preset => <button key={preset} type="button" aria-pressed={clip.textTemplate?.preset === preset} onClick={() => onChange(textTemplatePatch(clip, preset))}>
      <TextTemplatePreview preset={preset}/>
      <span>{REMOTION_TEXT_LABELS[preset]}</span>
    </button>)}</div>
    {clip.textTemplate?.preset === 'karaoke' && <p className="visual-control-note">Highlights words across this clip’s duration.</p>}
    <div className="text-effect-presets" role="group" aria-label="Text animation">{TEXT_EFFECT_PRESETS.map(preset => <Button key={preset} variant="outline" aria-pressed={selected === preset} onClick={() => onChange(textEffectPatch(clip, preset))}>{TEXT_EFFECT_LABELS[preset]}</Button>)}</div>
    <p className="visual-control-note">Animates this text clip. Move or trim it on the timeline to change its timing.</p>
  </div>;
}
