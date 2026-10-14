'use client';

import { TEXT_LOOKS, textLookPatch, type TextLookId } from '@/lib/editor/text-looks';
import { selectedTextAnimation } from '@/lib/editor/text-effects';
import type { Clip } from '@/lib/editor/types';
import { TextAnimationPreview } from './text-animation-preview';
import { TextPreviewCard } from './text-preview-card';

export function TextLookPicker({ selected, onSelect }: { selected?: TextLookId; onSelect?: (look: TextLookId) => void }) {
  const source: Clip = { id: 'look-preview', kind: 'graphic', text: 'Your story', start: 0, duration: 3, sourceStart: 0 };
  return <div className="text-preset-picker text-look-picker" role="group" aria-label="Text presets">{TEXT_LOOKS.map(look => {
    const clip = { ...source, ...textLookPatch(source, look.id) };
    return <TextPreviewCard key={look.id} className="text-look-card" label={look.label} selected={selected === look.id} onSelect={onSelect ? () => onSelect(look.id) : undefined} render={frame => <TextAnimationPreview preset={selectedTextAnimation(clip) ?? 'none'} clip={clip} frame={frame}/>}/>;
  })}</div>;
}
