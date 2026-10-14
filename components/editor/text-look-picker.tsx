'use client';

import { TEXT_LOOKS, textLookPatch, type TextLookId } from '@/lib/editor/text-looks';
import { selectedTextAnimation } from '@/lib/editor/text-effects';
import type { Clip } from '@/lib/editor/types';
import { TextAnimationPreview } from './text-animation-preview';
import { TextPreviewCard } from './text-preview-card';

export function TextLookPicker({ selected, onSelect, query = '' }: { selected?: TextLookId; onSelect?: (look: TextLookId) => void; query?: string }) {
  const source: Clip = { id: 'look-preview', kind: 'graphic', text: 'Your story', start: 0, duration: 3, sourceStart: 0 };
  const search = query.trim().toLowerCase();
  const looks = TEXT_LOOKS.filter(look => `${look.label} ${look.description}`.toLowerCase().includes(search));
  if (!looks.length) return <p className="library-empty" role="status">No matching text presets.</p>;
  return <div className="text-preset-picker text-look-picker" role="group" aria-label="Text presets">{looks.map(look => {
    const clip = { ...source, ...textLookPatch(source, look.id) };
    return <TextPreviewCard key={look.id} className="text-look-card" label={look.label} selected={selected === look.id} onSelect={onSelect ? () => onSelect(look.id) : undefined} render={frame => <TextAnimationPreview preset={selectedTextAnimation(clip) ?? 'none'} clip={clip} frame={frame}/>}/>;
  })}</div>;
}
