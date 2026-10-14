import type { Clip } from './types';
import { DEFAULT_TEXT_APPEARANCE, type TextAppearance } from './text-style';
import { textAnimationPatch, type TextAnimationPreset } from './text-effects';

type TextLook = { id: string; label: string; color: string; background: string; fontSize: number; blendMode: NonNullable<Clip['blendMode']>; style: TextAppearance; animation?: TextAnimationPreset; accent?: string };
const appearance = (patch: Partial<TextAppearance> = {}): TextAppearance => ({ ...DEFAULT_TEXT_APPEARANCE, ...patch });

/** Looks are editable combinations. Animations are offered separately and never set colors. */
export const TEXT_LOOKS = [
  { id: 'default', label: 'Default text', color: '#F4F4F0', background: 'transparent', fontSize: 92, blendMode: 'normal', style: appearance(), animation: 'none' },
  { id: 'bold', label: 'Bold', color: '#F5CF45', background: 'transparent', fontSize: 104, blendMode: 'normal', style: appearance() },
  { id: 'boxed', label: 'Boxed', color: '#F4F4F0', background: '#0B0C0EE6', fontSize: 92, blendMode: 'normal', style: appearance() },
  { id: 'highlight', label: 'Highlight', color: '#151619', background: '#F5CF45', fontSize: 92, blendMode: 'normal', style: appearance() },
  { id: 'difference', label: 'Difference', color: '#FFFFFF', background: 'transparent', fontSize: 92, blendMode: 'difference', style: appearance() },
  { id: 'neon-echo', label: 'Neon Echo', color: '#B72CFF', background: 'transparent', fontSize: 100, blendMode: 'normal', style: appearance({ strokeWidth: 4, strokeColor: '#FF962E', glowBlur: 34, glowColor: '#B72CFF' }), animation: 'neon-echo', accent: '#FF962E' },
] as const satisfies readonly TextLook[];
export type TextLookId = typeof TEXT_LOOKS[number]['id'];

export function textLookPatch(clip: Clip, id: TextLookId): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select text before applying a look.');
  const look: TextLook = TEXT_LOOKS.find(item => item.id === id)!;
  const animation = look.animation ? textAnimationPatch(clip, look.animation) : {};
  return { ...animation, color: look.color, background: look.background, fontSize: look.fontSize, blendMode: look.blendMode, textStyle: { ...look.style },
    ...(look.accent && animation.textTemplate ? { textTemplate: { ...animation.textTemplate, highlightColor: look.accent } } : {}) };
}

export function selectedTextLook(clip: Clip): TextLookId | undefined {
  return TEXT_LOOKS.find(look => clip.color === look.color && (clip.background ?? 'transparent') === look.background && (clip.blendMode ?? 'normal') === look.blendMode && Object.keys(DEFAULT_TEXT_APPEARANCE).every(key => (clip.textStyle ?? DEFAULT_TEXT_APPEARANCE)[key as keyof TextAppearance] === look.style[key as keyof TextAppearance]))?.id;
}
