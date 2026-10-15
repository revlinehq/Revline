'use client';

import { TEXT_ANIMATION_LABELS, type TextAnimationPreset } from '@/lib/editor/text-effects';
import type { Clip } from '@/lib/editor/types';
import { TextPreviewCard } from './text-preview-card';
import { TextAnimationPreview } from './text-animation-preview';

export default function TextPresetPicker({ presets, selected, onSelect, clip }: { presets: readonly TextAnimationPreset[]; selected?: TextAnimationPreset | null; onSelect?: (preset: TextAnimationPreset) => void; clip?: Clip }) {
  return <div className="text-preset-picker" role="group" aria-label="Text animations">{presets.map(preset => <TextPreviewCard key={preset} previewFirst autoPlay label={TEXT_ANIMATION_LABELS[preset]} selected={selected === preset} onSelect={onSelect ? () => onSelect(preset) : undefined} render={frame => <TextAnimationPreview preset={preset} frame={frame} clip={clip}/>}/>)}</div>;
}
