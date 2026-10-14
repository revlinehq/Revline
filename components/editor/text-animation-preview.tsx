import { RemotionText } from '@/lib/editor/remotion-text-component';
import { remotionTextProps } from '@/lib/editor/remotion-text';
import { textAnimationPatch, type TextAnimationPreset } from '@/lib/editor/text-effects';
import { textLayerFrame } from '@/lib/editor/text-layers';
import type { Clip } from '@/lib/editor/types';
import { textAppearance } from '@/lib/editor/text-style';
import { textFont } from '@/lib/editor/text-fonts';
import { TEXT_PREVIEW_DURATION, TEXT_PREVIEW_FPS } from './text-preview-card';

export function TextAnimationPreview({ preset, frame, clip }: { preset: TextAnimationPreset; frame: number; clip?: Clip }) {
  const original: Clip = { id: 'preview', kind: 'graphic', text: 'Tell your story', sourceStart: 0, color: '#F4F4F0', ...clip, start: 0, duration: TEXT_PREVIEW_DURATION / TEXT_PREVIEW_FPS };
  const preview = { ...original, ...textAnimationPatch(original, preset), start: 0, duration: TEXT_PREVIEW_DURATION / TEXT_PREVIEW_FPS, fontSize: 92 };
  const resolution = 1080 * 18 / 92;
  const layer = textLayerFrame({ clip: preview, index: 0, fps: TEXT_PREVIEW_FPS, resolution }, frame / TEXT_PREVIEW_FPS, 180, 72);
  const template = remotionTextProps(preview, frame / TEXT_PREVIEW_FPS, TEXT_PREVIEW_FPS, resolution);
  const font = textFont(preview.fontFamily);
  return <span data-text-animation={preset} data-frame={frame} style={{ display: 'inline-block', fontSize: layer.style.fontSize, color: layer.style.color, background: layer.style.background, opacity: layer.opacity, transform: `${layer.transform} translateY(${layer.lift}px)`, mixBlendMode: preview.blendMode, fontFamily: font.family, fontWeight: font.weight, ...textAppearance(preview, resolution) }}>
    {template ? <RemotionText {...template}/> : preview.text}
  </span>;
}
