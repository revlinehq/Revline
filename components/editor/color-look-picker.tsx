'use client';

import { useState } from 'react';
import { COLOR_LOOKS, colorLookGrade, isNeutralColorGrade, selectedColorLook, type ColorLookId } from '@/lib/editor/color-looks';
import type { ColorGrade } from '@/lib/editor/visual-effects';
import { EffectSlider } from './effect-slider';
import './color-look-picker.css';

export function ColorLookPicker({ selected, disabled = false, query = '', onSelect }: { selected?: ColorLookId; disabled?: boolean; query?: string; onSelect: (id: ColorLookId) => void }) {
  const looks = COLOR_LOOKS.filter(look => `${look.label} cinematic color`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="color-look-picker" aria-label="Cinematic color presets">
    {looks.map(look => <button key={look.id} type="button" disabled={disabled} aria-label={`Apply ${look.label}`} aria-pressed={selected === look.id} onClick={() => onSelect(look.id)}>
      <span className="color-look-swatch" aria-hidden="true">{look.colors.map(color => <i key={color} style={{ backgroundColor: color }}/>)}</span>
      <span>{look.label}</span>
    </button>)}
  </div>;
}

export function ColorLookControls({ grade, onChange, onPreview }: { grade: ColorGrade; onChange: (grade: ColorGrade) => void; onPreview?: (grade: ColorGrade | null) => void }) {
  const [lastLook, setLastLook] = useState<ColorLookId | null>(null);
  const selected = selectedColorLook(grade) ?? (grade.enabled && lastLook && isNeutralColorGrade(grade) ? { id: lastLook, strength: 0 } : undefined);
  return <section className="color-look-controls" aria-label="Cinematic looks">
    <h3>Cinematic looks</h3>
    <ColorLookPicker selected={selected?.id} onSelect={id => { setLastLook(id); onChange(colorLookGrade(id)); }}/>
    {selected && <EffectSlider label="Strength" ariaLabel="Color look strength" value={selected.strength} bounds={[0, 1]} format={value => `${Math.round(value * 100)}%`} disabled={!grade.enabled}
      onPreview={value => onPreview?.(value === null ? null : colorLookGrade(selected.id, value))} onCommit={value => onChange(colorLookGrade(selected.id, value))}/>}
  </section>;
}
