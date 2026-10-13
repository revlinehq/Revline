'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BLEND_MODES, EFFECT_PRESETS, effectClipLabel, motionPreset, type EffectPreset } from '@/lib/editor/clip-effects';
import { formatTime, type Clip } from '@/lib/editor/types';
import './clip-effects-controls.css';

const blends = { normal: 'Normal', screen: 'Screen', multiply: 'Multiply', overlay: 'Overlay', 'plus-lighter': 'Add light' };

export function EffectControls({ clip, fps, onChange, onAddEffect }: { clip?: Clip; fps: number; onChange: (patch: Partial<Clip>) => void; onAddEffect: (preset: EffectPreset) => void }) {
  const effect = clip?.kind === 'effect';
  const visual = clip && clip.kind !== 'audio' && !effect;
  return <div className="clip-effects-controls">
    <div className="inspector-selection"><small>{effect ? 'Effect clip' : 'Add effect at playhead'}</small><p>{effect ? effectClipLabel(clip) : 'Choose an effect'}</p></div>
    {effect && <p className="visual-control-note">{formatTime(clip.start,true,fps)} – {formatTime(clip.start+clip.duration,true,fps)}<br/>Drag the amber clip to move it. Trim its edges to change how long it lasts.</p>}
    <fieldset><legend>{effect ? 'Change preset' : 'Effects'}</legend><div className="clip-motion-presets">{EFFECT_PRESETS.map(preset => <Button key={preset} variant="outline" aria-pressed={effect ? clip.effectPreset === preset : undefined} onClick={() => effect ? onChange(motionPreset(clip, preset)) : onAddEffect(preset)}>{effectClipLabel({effectPreset:preset})}</Button>)}</div></fieldset>
    <p className="visual-control-note">{effect ? 'This clip affects the visual tracks below it during its highlighted range.' : 'Adds a separate amber clip at the playhead. Move it to a beat and trim its duration on the timeline.'}</p>
    {effect && <Button variant="outline" onClick={()=>onAddEffect(EFFECT_PRESETS.find(preset=>preset===clip.effectPreset)??'punch')}><Plus size={14}/>Add another at playhead</Button>}
    {visual && <>
      {!!clip.motion?.length && <Button variant="outline" onClick={()=>onChange(motionPreset(clip,'none'))}>Remove existing clip motion</Button>}
      {clip.animation && clip.animation !== 'none' && <Button variant="outline" onClick={()=>onChange({animation:'none'})}>Remove text animation</Button>}
      <label className="inspector-field">Blend mode<select aria-label="Blend mode" value={clip.blendMode ?? 'normal'} onChange={event => onChange({ blendMode: event.target.value as Clip['blendMode'] })}>{BLEND_MODES.map(mode => <option key={mode} value={mode}>{blends[mode]}</option>)}</select></label>
      <p className="visual-control-note">Blend applies to the selected clip. Use Screen for a light overlay above the footage.</p>
    </>}
  </div>;
}
