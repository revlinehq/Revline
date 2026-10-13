'use client';

import { Check, Plus } from 'lucide-react';
import { SUBTITLE_STYLES, type SubtitleStyleId } from '@/lib/editor/subtitle-styles';
import { textStyle } from '@/lib/editor/text-style';
import './subtitle-style-picker.css';

export function SubtitleStylePicker({ selected, query = '', onSelect }: {
  selected?: SubtitleStyleId; query?: string; onSelect?: (style: SubtitleStyleId) => void;
}) {
  const styles = SUBTITLE_STYLES.filter(style => `${style.label} subtitles`.toLowerCase().includes(query.toLowerCase()));
  if (!styles.length) return null;
  return <section className="subtitle-style-section" aria-label="Subtitle styles"><h3>Subtitle styles</h3><div className="subtitle-style-picker">{styles.map(style => {
    const appearance = textStyle({ kind: 'caption', ...style.appearance }, 350);
    return <button key={style.id} className="subtitle-style-card" type="button" aria-label={`${style.label} subtitles`} aria-pressed={selected === style.id} disabled={!onSelect} onClick={() => onSelect?.(style.id)}>
      <span className={`subtitle-style-stage ${style.id === 'difference' ? 'subtitle-style-difference' : ''}`} aria-hidden="true"><span style={{ color: appearance.color, background: appearance.background, fontSize: appearance.fontSize, mixBlendMode: style.appearance.blendMode }}>Your story</span></span>
      <span className="subtitle-style-label"><span>{style.label}</span>{selected === style.id ? <Check size={12} aria-hidden="true"/> : <Plus size={12} aria-hidden="true"/>}</span>
    </button>;
  })}</div></section>;
}
