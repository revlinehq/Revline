import type { Clip } from './types';
import { DEFAULT_TEXT_APPEARANCE, type TextAppearance } from './text-style';

type TextLook = { id: string; label: string; description: string; color: string; background: string; fontSize: number; blendMode: NonNullable<Clip['blendMode']>; style: TextAppearance };
const appearance = (patch: Partial<TextAppearance> = {}): TextAppearance => ({ ...DEFAULT_TEXT_APPEARANCE, ...patch });

/** Looks change appearance only; existing animation and its controls stay intact. */
export const TEXT_LOOKS = [
  { id: 'default', label: 'Default text', description: "Plain light text on a transparent background; clears stroke, shadow and glow while preserving animation.", color: '#F4F4F0', background: 'transparent', fontSize: 92, blendMode: 'normal', style: appearance() },
  { id: 'bold', label: 'Bold', description: "Larger gold text on a transparent background, ready for separate editable animation and appearance controls.", color: '#F5CF45', background: 'transparent', fontSize: 104, blendMode: 'normal', style: appearance() },
  { id: 'boxed', label: 'Boxed', description: "Light text over a dark translucent text box for readable titles and captions.", color: '#F4F4F0', background: '#0B0C0EE6', fontSize: 92, blendMode: 'normal', style: appearance() },
  { id: 'highlight', label: 'Highlight', description: "Dark text over a solid yellow highlight block; background and text colors remain editable.", color: '#151619', background: '#F5CF45', fontSize: 92, blendMode: 'normal', style: appearance() },
  { id: 'difference', label: 'Difference', description: "White text with Difference blend for contrast against the footage beneath it.", color: '#FFFFFF', background: 'transparent', fontSize: 92, blendMode: 'difference', style: appearance() },
  { id: 'neon-echo', label: 'Neon Echo', description: "Purple text with an orange stroke and purple glow; preserves the selected animation and its effect color.", color: '#B72CFF', background: 'transparent', fontSize: 100, blendMode: 'normal', style: appearance({ strokeWidth: 4, strokeColor: '#FF962E', glowBlur: 34, glowColor: '#B72CFF' }) },
] as const satisfies readonly TextLook[];
export type TextLookId = typeof TEXT_LOOKS[number]['id'];

export function textLookPatch(clip: Clip, id: TextLookId): Partial<Clip> {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Select text before applying a look.');
  const look: TextLook = TEXT_LOOKS.find(item => item.id === id)!;
  return { color: look.color, background: look.background, fontSize: look.fontSize, blendMode: look.blendMode, textStyle: { ...look.style } };
}

export function selectedTextLook(clip: Clip): TextLookId | undefined {
  return TEXT_LOOKS.find(look => clip.color === look.color && (clip.background ?? 'transparent') === look.background && (clip.blendMode ?? 'normal') === look.blendMode && Object.keys(DEFAULT_TEXT_APPEARANCE).every(key => (clip.textStyle ?? DEFAULT_TEXT_APPEARANCE)[key as keyof TextAppearance] === look.style[key as keyof TextAppearance]))?.id;
}
