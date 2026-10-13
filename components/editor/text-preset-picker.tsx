'use client';

import { memo, useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { RemotionText } from '@/lib/editor/remotion-text-component';
import { DEFAULT_TEXT_HIGHLIGHT, REMOTION_TEXT_LABELS, VFX_TEXT_APPEARANCE, type RemotionTextPreset } from '@/lib/editor/remotion-text';
import './text-preset-picker.css';

const FPS = 30;
const DURATION = 90;
const HOLD_FRAME = 45;
const previewWords: Record<RemotionTextPreset, string> = {
  'word-reveal': 'Tell your story', 'word-pop': 'Make it pop', 'slide-title': 'Your next chapter', karaoke: 'Sing it with me',
  'neon-echo': 'AFTER HOURS', 'lyric-slam': 'FEEL THE BEAT', 'kinetic-stack': 'MAKE IT MOVE',
};

const TextPresetCard = memo(function TextPresetCard({ preset, active, selected, disabled, onSelect }: {
  preset: RemotionTextPreset; active: boolean; selected?: boolean; disabled: boolean;
  onSelect?: (preset: RemotionTextPreset) => void;
}) {
  const [frame, setFrame] = useState(HOLD_FRAME);
  useEffect(() => {
    if (!active) return;
    let request = 0;
    const started = performance.now();
    setFrame(0);
    const tick = (now: number) => {
      setFrame(Math.floor((now - started) / 1000 * FPS) % DURATION);
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [active]);
  const appearance = VFX_TEXT_APPEARANCE[preset];
  return <button type="button" className="text-preset-card" disabled={disabled} aria-label={REMOTION_TEXT_LABELS[preset]} aria-pressed={selected} onClick={() => onSelect?.(preset)}>
    <span className="text-preset-stage" aria-hidden="true">
      <RemotionText preset={preset} text={previewWords[preset]} frame={active ? frame : HOLD_FRAME} fps={FPS} durationInFrames={DURATION} fontSize={18} color={appearance?.color ?? '#F5F4FA'} highlightColor={appearance?.highlightColor ?? DEFAULT_TEXT_HIGHLIGHT}/>
    </span>
    <span className="text-preset-label"><span>{REMOTION_TEXT_LABELS[preset]}</span>{selected ? <Check size={12} aria-hidden="true"/> : <Plus size={12} aria-hidden="true"/>}</span>
  </button>;
});

/** Uses the same frame renderer as preview/export. Only the hovered or focused card runs a clock. */
export default function TextPresetPicker({ presets, selected, onSelect }: {
  presets: readonly RemotionTextPreset[]; selected?: RemotionTextPreset; onSelect?: (preset: RemotionTextPreset) => void;
}) {
  const [hovered, setHovered] = useState<RemotionTextPreset>();
  const [focused, setFocused] = useState<RemotionTextPreset>();
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  const active = reducedMotion ? undefined : hovered ?? focused;
  return <div className="text-preset-picker" role="group" aria-label="Text templates">{presets.map(preset => <div key={preset} className="text-preset-item" onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(preset); }} onPointerLeave={() => setHovered(undefined)} onFocus={() => setFocused(preset)} onBlur={() => setFocused(undefined)}>
    <TextPresetCard preset={preset} active={active === preset && !!onSelect} selected={selected === preset} disabled={!onSelect} onSelect={onSelect}/>
  </div>)}</div>;
}
