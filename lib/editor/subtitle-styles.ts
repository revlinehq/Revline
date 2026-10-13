import type { Clip } from './types';

type SubtitleAppearance = Pick<Clip, 'color' | 'background' | 'fontSize'>;
export const SUBTITLE_STYLES = [
  { id: 'clean', label: 'Clean', appearance: { color: '#FFFFFF', background: 'transparent', fontSize: 52 } },
  { id: 'bold', label: 'Bold', appearance: { color: '#F5CF45', background: 'transparent', fontSize: 64 } },
  { id: 'boxed', label: 'Boxed', appearance: { color: '#FFFFFF', background: '#0B0C0EE6', fontSize: 52 } },
  { id: 'highlight', label: 'Highlight', appearance: { color: '#0B0C0E', background: '#F5CF45', fontSize: 52 } },
] as const satisfies readonly { id: string; label: string; appearance: SubtitleAppearance }[];
export type SubtitleStyleId = typeof SUBTITLE_STYLES[number]['id'];

/** Appearance only: words, timing, rotation and animation remain independent. */
export function subtitleStylePatch(id: SubtitleStyleId): SubtitleAppearance {
  return { ...SUBTITLE_STYLES.find(style => style.id === id)!.appearance };
}

export function selectedSubtitleStyle(clip: Clip | undefined): SubtitleStyleId | undefined {
  if (clip?.kind !== 'caption') return;
  return SUBTITLE_STYLES.find(({ appearance }) => clip.color?.toUpperCase() === appearance.color.toUpperCase() && (clip.background ?? 'transparent').toUpperCase() === appearance.background.toUpperCase() && (clip.fontSize ?? 52) === appearance.fontSize)?.id;
}
