import { isTextFont, textFont, textFontWeight, type TextFontId } from './text-fonts';

export type TextTypography = {
  fontWeight?: number; italic?: boolean; letterSpacing?: number; lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right'; paddingX?: number; paddingY?: number; borderRadius?: number;
};
export type TextAppearance = TextTypography & {
  strokeWidth: number; strokeColor: string;
  shadowBlur: number; shadowX: number; shadowY: number; shadowColor: string;
  glowBlur: number; glowColor: string;
};
export const DEFAULT_TEXT_APPEARANCE: Readonly<TextAppearance> = {
  strokeWidth: 0, strokeColor: '#000000', shadowBlur: 0, shadowX: 0, shadowY: 0, shadowColor: '#000000', glowBlur: 0, glowColor: '#FFFFFF',
};
export const TEXT_APPEARANCE_LIMITS = { strokeWidth: [0,20], shadowBlur: [0,80], shadowX: [-100,100], shadowY: [-100,100], glowBlur: [0,100] } as const;
export const TEXT_TYPOGRAPHY_LIMITS = { fontWeight: [100,900], letterSpacing: [-10,100], lineHeight: [.5,3], paddingX: [0,200], paddingY: [0,200], borderRadius: [0,200] } as const;
type TextStyleInput = {
  kind: string; text?: string; x?: number; y?: number; fontSize?: number;
  color?: string; background?: string; blendMode?: string;
  transform?: { rotation: number };
  textStyle?: TextAppearance;
  fontFamily?: TextFontId;
  textTemplate?: { preset: string; highlightColor?: string };
};
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
const colorPattern = /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i;
const color = (value: string | undefined, fallback: string) => value && colorPattern.test(value) ? value : fallback;

export function validateTextStyle(clip: Pick<TextStyleInput, 'kind' | 'textStyle' | 'fontFamily'>) {
  if (clip.fontFamily !== undefined && (!isTextFont(clip.fontFamily) || (clip.kind !== 'caption' && clip.kind !== 'graphic'))) throw new Error('Choose a supported text font for a text clip.');
  if (clip.textStyle === undefined) return;
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Text appearance applies to text clips only.');
  for (const [key, [min,max]] of Object.entries(TEXT_APPEARANCE_LIMITS)) {
    const value = clip.textStyle[key as keyof typeof TEXT_APPEARANCE_LIMITS];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Text ${key} must be between ${min} and ${max}.`);
  }
  for (const key of ['strokeColor','shadowColor','glowColor'] as const) if (!colorPattern.test(clip.textStyle[key])) throw new Error('Text style colors must use a hex value or transparent.');
  for (const [key, [min,max]] of Object.entries(TEXT_TYPOGRAPHY_LIMITS)) {
    const value = clip.textStyle[key as keyof typeof TEXT_TYPOGRAPHY_LIMITS];
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max || key === 'fontWeight' && !Number.isInteger(value))) throw new Error(`Text ${key} must be between ${min} and ${max}${key === 'fontWeight' ? ' and an integer' : ''}.`);
  }
  if (clip.textStyle.italic !== undefined && typeof clip.textStyle.italic !== 'boolean') throw new Error('Text italic must be a boolean.');
  if (clip.textStyle.textAlign !== undefined && !['left','center','right'].includes(clip.textStyle.textAlign)) throw new Error('Text alignment must be left, center or right.');
}

/** Animated wrappers inherit the chosen typography instead of resetting it.
 * Omitted controls keep each existing animation's default spacing. */
export function textTypographyStyle(appearance: TextTypography | undefined, resolution = 1080) {
  const scale = resolution / 1080;
  return {
    ...(appearance?.italic !== undefined ? {fontStyle: appearance.italic ? 'italic' as const : 'normal' as const} : {}),
    ...(appearance?.letterSpacing !== undefined ? {letterSpacing: appearance.letterSpacing * scale} : {}),
    ...(appearance?.lineHeight !== undefined ? {lineHeight: appearance.lineHeight} : {}),
    ...(appearance?.textAlign !== undefined ? {textAlign: appearance.textAlign} : {}),
  };
}

/** Every size uses the same 1080p design coordinate system as text size. */
export function textAppearance(clip: Pick<TextStyleInput, 'textStyle'>, resolution = 1080) {
  const appearance = clip.textStyle ?? DEFAULT_TEXT_APPEARANCE, scale = resolution / 1080;
  const shadows: string[] = [];
  if (appearance.shadowBlur || appearance.shadowX || appearance.shadowY) shadows.push(`${appearance.shadowX * scale}px ${appearance.shadowY * scale}px ${appearance.shadowBlur * scale}px ${appearance.shadowColor}`);
  if (appearance.glowBlur) shadows.push(`0 0 ${appearance.glowBlur * scale}px ${appearance.glowColor}`);
  return { WebkitTextStroke: `${appearance.strokeWidth * scale}px ${appearance.strokeColor}`, paintOrder: 'stroke fill' as const, textShadow: shadows.join(',') || 'none' };
}

/** Materialize a legacy look once, so later animation changes cannot replace its appearance. */
export function resolvedTextAppearance(clip: Pick<TextStyleInput, 'kind' | 'textStyle' | 'textTemplate' | 'fontSize' | 'color'>): TextAppearance {
  if (clip.textStyle) return { ...clip.textStyle };
  const base = { ...DEFAULT_TEXT_APPEARANCE }, size = bounded(clip.fontSize, clip.kind === 'caption' ? 52 : 92, 8, 300);
  const preset = clip.textTemplate?.preset;
  const accent = clip.textTemplate?.highlightColor ?? (preset === 'kinetic-stack' ? '#BA83FF' : preset === 'lyric-slam' ? '#FF6E36' : '#FF962E');
  if (preset === 'neon-echo') return { ...base, strokeWidth: size * .048, strokeColor: accent, glowBlur: Math.min(100,size * .36), glowColor: clip.color ?? '#B72CFF' };
  if (preset === 'lyric-slam') return { ...base, strokeWidth: size * .028, strokeColor: accent, shadowX: size * .045, shadowY: size * .05, shadowColor: accent };
  if (preset === 'kinetic-stack') return { ...base, strokeWidth: size * .016, strokeColor: accent, shadowY: size * .045, shadowBlur: size * .08 };
  return clip.kind === 'caption' ? { ...base, shadowY: 2, shadowBlur: 12, shadowColor: '#00000099' } : base;
}

/** Resolve the same text appearance for preview, templates, handles and export. */
export function textStyle(clip: TextStyleInput, resolution = 1080) {
  const font = textFont(clip.fontFamily), typography = clip.textStyle, scale = resolution / 1080;
  return {
    text: (clip.text ?? '').slice(0, 2000),
    x: bounded(clip.x, .5, 0, 1), y: bounded(clip.y, clip.kind === 'caption' ? .82 : .5, 0, 1),
    fontSize: bounded(clip.fontSize, clip.kind === 'caption' ? 52 : 92, 8, 300) * resolution / 1080,
    color: color(clip.color, '#F4F4F0'), background: color(clip.background, 'transparent'),
    blendMode: clip.blendMode ?? 'normal',
    fontFamily: font.family, fontWeight: textFontWeight(clip.fontFamily, typography?.fontWeight),
    fontStyle: typography?.italic ? 'italic' : 'normal',
    letterSpacing: bounded(typography?.letterSpacing, 0, -10, 100) * scale,
    lineHeight: bounded(typography?.lineHeight, 1.12, .5, 3), textAlign: typography?.textAlign ?? 'center',
    paddingX: bounded(typography?.paddingX, 18, 0, 200) * scale, paddingY: bounded(typography?.paddingY, 10, 0, 200) * scale,
    borderRadius: bounded(typography?.borderRadius, 8, 0, 200) * scale,
    transform: `translate(-50%,-50%) rotate(${bounded(clip.transform?.rotation, 0, -360, 360)}deg)`,
  };
}
