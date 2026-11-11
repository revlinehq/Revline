import { DEFAULT_TEXT_APPEARANCE, type TextAppearance } from './text-style';
import type { TextFontId } from './text-fonts';
import type { KaraokeStyle, TextTemplate } from './text-templates';
import type { TextGradient } from './text-gradient';

/**
 * Caption presets: complete caption looks with word-by-word motion, applied to captions in one step by the
 * assistant (applyCaptionStyle / addSubtitlesFromTranscript `preset`), MCP clients and the editor's Effects tab.
 * Sizes are design pixels on a 1080-wide frame. The look is written into the clip's ordinary fields (font, size,
 * colours, stroke, box), so it stays editable and an older renderer still draws it; `captionPreset` on the clip
 * adds the motion, drawn by `CaptionPresetText` in the preview, frames and exports alike.
 */
export const CAPTION_PRESET_IDS = ['bold-pop', 'karaoke-box', 'clean-minimal', 'impact-caps', 'comic-punch', 'marker', 'two-tone-stack', 'gradient-hype', 'tiktok-outline', 'tiktok-box', 'reels'] as const;
export type CaptionPresetId = typeof CAPTION_PRESET_IDS[number];
/** pop: every word shown, the spoken one coloured and enlarged. box: a box sits behind the spoken word.
 *  fill: unspoken words are dimmed and light up. reveal: unspoken words are hidden and grow in.
 *  single-word: only the spoken word is on screen. */
export type CaptionHighlightMode = 'pop' | 'box' | 'fill' | 'reveal' | 'single-word';
/** Seconds and scale factors. popScale: the spoken word's size; popDuration: its spring up and back;
 *  colorDuration: colour, glow and box changes; lineDuration: a new caption fading and rising in;
 *  revealFrom: the size a revealed word grows from. */
export type CaptionMotion = { popScale: number; popDuration: number; colorDuration: number; lineDuration: number; revealFrom: number };
export const DEFAULT_CAPTION_MOTION: CaptionMotion = { popScale: 1.14, popDuration: .34, colorDuration: .16, lineDuration: .26, revealFrom: .78 };
export const CAPTION_MOTION_LIMITS = { popScale: [1, 1.6], popDuration: [.1, 1] } as const;
/** What a clip stores: which preset, plus any tuned motion. */
export type ClipCaptionPreset = { id: CaptionPresetId; popScale?: number; popDuration?: number };

export type CaptionPreset = {
  id: CaptionPresetId; number: number; name: string; description: string; mode: CaptionHighlightMode;
  font: TextFontId; weight: number; fontSize: number; uppercase?: boolean;
  /** Text colour; the spoken word's colour (pop, fill) or its box (box). */
  color: string; highlight?: string;
  /** Text colour of the spoken word inside its box. */
  activeText?: string;
  /** The spoken word drops the caption's shadow (it sits on a solid chip). */
  activeShadow?: false;
  letterSpacing?: number; lineHeight?: number;
  stroke?: { width: number; color: string };
  shadow?: { x: number; y: number; blur: number; color: string };
  /** A box behind the whole caption (design px). */
  box?: { color: string; paddingX: number; paddingY: number; radius: number };
  /** Padding around each word (em), and the colour behind words that are not being spoken. */
  wordBox?: { paddingX: number; paddingY: number; radius: number; color?: string };
  /** Space between words (em), when it differs from a normal space. */
  wordGap?: number;
  /** fill: opacity of words not yet spoken. */
  dim?: number;
  /** pop: the spoken word grows to this many times the font size (it reflows the line). */
  grow?: number;
  /** single-word: rotation in degrees. */
  tilt?: number;
  gradient?: string[];
  motion?: Partial<CaptionMotion>;
  /** Words per caption when captions are made in this preset from a transcript. */
  maxWords: number;
  /** The karaoke look an older renderer draws instead (it has no presets); null draws static text. */
  legacy: KaraokeStyle | null;
};

export const CAPTION_PRESETS: readonly CaptionPreset[] = [
  { id: 'bold-pop', number: 1, name: 'Bold Pop', description: 'Montserrat Black capitals with a thick black outline; the spoken word turns yellow and pops.', mode: 'pop',
    font: 'montserrat', weight: 900, fontSize: 84, uppercase: true, color: '#FFFFFF', highlight: '#FFE600', stroke: { width: 18, color: '#000000' }, maxWords: 3, legacy: 'pop' },
  { id: 'karaoke-box', number: 2, name: 'Karaoke Box', description: 'Poppins ExtraBold; a purple rounded box jumps to the spoken word.', mode: 'box',
    font: 'poppins', weight: 800, fontSize: 72, color: '#FFFFFF', highlight: '#7C3AED', activeText: '#FFFFFF', shadow: { x: 0, y: 7, blur: 0, color: '#00000099' },
    wordBox: { paddingX: .29, paddingY: .05, radius: .29 }, wordGap: .1, maxWords: 3, legacy: 'box' },
  { id: 'clean-minimal', number: 3, name: 'Clean Minimal', description: 'DM Sans Bold, small; unspoken words are dimmed and light up as they are spoken.', mode: 'fill',
    font: 'dm-sans', weight: 700, fontSize: 56, color: '#FFFFFF', shadow: { x: 0, y: 4, blur: 20, color: '#000000D9' }, dim: .4, maxWords: 6, legacy: null },
  { id: 'impact-caps', number: 4, name: 'Impact Caps', description: 'Anton tall capitals with an outline; the spoken word turns green and pops.', mode: 'pop',
    font: 'anton', weight: 400, fontSize: 104, uppercase: true, letterSpacing: 1, color: '#FFFFFF', highlight: '#3DFF7A', stroke: { width: 20, color: '#000000' }, maxWords: 3, legacy: 'pop' },
  { id: 'comic-punch', number: 5, name: 'Comic Punch', description: 'Bangers, yellow with a black outline; one big tilted word on screen at a time.', mode: 'single-word',
    font: 'bangers', weight: 400, fontSize: 150, letterSpacing: 3, color: '#FFD400', stroke: { width: 20, color: '#000000' }, tilt: -5, maxWords: 3, legacy: 'pop' },
  { id: 'marker', number: 6, name: 'Marker', description: 'Archivo Black capitals on yellow highlighter bars; the spoken word flips to black with yellow text.', mode: 'box',
    font: 'archivo-black', weight: 400, fontSize: 64, uppercase: true, color: '#111111', highlight: '#111111', activeText: '#FFE600', lineHeight: 1.3,
    wordBox: { paddingX: .33, paddingY: .11, radius: 0, color: '#FFE600' }, wordGap: 0, maxWords: 3, legacy: null },
  { id: 'two-tone-stack', number: 7, name: 'Two-tone Stack', description: 'Oswald capitals; the spoken word grows big and turns orange.', mode: 'pop',
    font: 'oswald', weight: 600, fontSize: 60, uppercase: true, letterSpacing: 3, color: '#FFFFFF', highlight: '#FF5A3C', shadow: { x: 0, y: 7, blur: 0, color: '#000000A6' }, grow: 2.2, maxWords: 3, legacy: 'pop' },
  { id: 'gradient-hype', number: 8, name: 'Gradient Hype', description: 'Rubik Black capitals in a pink-to-orange gradient; the spoken word turns white.', mode: 'pop',
    font: 'rubik', weight: 900, fontSize: 88, uppercase: true, color: '#FFFFFF', highlight: '#FFFFFF', gradient: ['#FF4FA3', '#FF9A3C'], shadow: { x: 0, y: 7, blur: 0, color: '#000000' }, maxWords: 3, legacy: 'pop' },
  { id: 'tiktok-outline', number: 9, name: 'TikTok native, outline', description: 'TikTok Sans ExtraBold, white with a black outline; words appear one by one as spoken.', mode: 'reveal',
    font: 'tiktok-sans', weight: 800, fontSize: 64, color: '#FFFFFF', stroke: { width: 13, color: '#000000' }, motion: { popScale: 1.1 }, maxWords: 4, legacy: 'pop' },
  { id: 'tiktok-box', number: 10, name: 'TikTok native, box', description: 'TikTok Sans SemiBold, white on a rounded black box; words appear one by one as spoken.', mode: 'reveal',
    font: 'tiktok-sans', weight: 600, fontSize: 58, color: '#FFFFFF', box: { color: '#000000', paddingX: 34, paddingY: 17, radius: 24 }, motion: { popScale: 1.1 }, maxWords: 4, legacy: 'pop' },
  { id: 'reels', number: 11, name: 'Reels style', description: "Figtree ExtraBold with a soft shadow (nearest free match to Instagram's font); the spoken word sits in a white rounded chip; words appear one by one.", mode: 'reveal',
    font: 'figtree', weight: 800, fontSize: 66, color: '#FFFFFF', highlight: '#FFFFFF', activeText: '#111111', activeShadow: false, shadow: { x: 0, y: 4, blur: 28, color: '#000000BF' },
    wordBox: { paddingX: .32, paddingY: .05, radius: .42 }, wordGap: .08, motion: { popScale: 1.1 }, maxWords: 4, legacy: 'pop' },
];

export function captionPreset(id: CaptionPresetId): CaptionPreset { return CAPTION_PRESETS.find(preset => preset.id === id) ?? CAPTION_PRESETS[0]; }
export const isCaptionPresetId = (value: unknown): value is CaptionPresetId => CAPTION_PRESET_IDS.includes(value as CaptionPresetId);
/** A preset by id, number ("5", 5) or name ("Comic Punch", case and spacing ignored). */
export function findCaptionPreset(value: string | number): CaptionPreset | undefined {
  const key = String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return CAPTION_PRESETS.find(preset => String(preset.number) === key || preset.id.replace(/-/g, ' ') === key || preset.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === key);
}
/** The 11 presets as one line each, for tool descriptions. */
export const CAPTION_PRESET_GUIDE = CAPTION_PRESETS.map(preset => `${preset.number} ${preset.name} (${preset.id}): ${preset.description}`).join(' ');

export function captionMotion(stored: Pick<ClipCaptionPreset, 'id' | 'popScale' | 'popDuration'>): CaptionMotion {
  return { ...DEFAULT_CAPTION_MOTION, ...captionPreset(stored.id).motion, ...(stored.popScale !== undefined ? { popScale: stored.popScale } : {}), ...(stored.popDuration !== undefined ? { popDuration: stored.popDuration } : {}) };
}

export function validateCaptionPreset(clip: { kind: string; captionPreset?: ClipCaptionPreset }) {
  const stored = clip.captionPreset;
  if (stored === undefined) return;
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Caption presets apply to captions and text graphics only.');
  if (!isCaptionPresetId(stored.id)) throw new Error('Choose a supported caption preset.');
  for (const [key, [min, max]] of Object.entries(CAPTION_MOTION_LIMITS)) {
    const value = stored[key as keyof typeof CAPTION_MOTION_LIMITS];
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`Caption ${key} must be between ${min} and ${max}.`);
  }
}

type PresetTarget = { kind: string; duration: number; textTemplate?: TextTemplate };
/** The clip fields that make a caption this preset. Words, timing, position and saved word timings stay. */
export function captionPresetPatch(clip: PresetTarget, id: CaptionPresetId, tuning: { popScale?: number; popDuration?: number } = {}) {
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Choose a caption before applying a caption preset.');
  const preset = captionPreset(id);
  const textStyle: TextAppearance = {
    ...DEFAULT_TEXT_APPEARANCE, fontWeight: preset.weight,
    ...(preset.stroke ? { strokeWidth: preset.stroke.width, strokeColor: preset.stroke.color } : {}),
    ...(preset.shadow ? { shadowX: preset.shadow.x, shadowY: preset.shadow.y, shadowBlur: preset.shadow.blur, shadowColor: preset.shadow.color } : {}),
    ...(preset.letterSpacing !== undefined ? { letterSpacing: preset.letterSpacing } : {}),
    ...(preset.lineHeight !== undefined ? { lineHeight: preset.lineHeight } : {}),
    ...(preset.box ? { paddingX: preset.box.paddingX, paddingY: preset.box.paddingY, borderRadius: preset.box.radius } : {}),
  };
  const previous = clip.textTemplate?.preset === 'karaoke' ? clip.textTemplate : undefined;
  const textTemplate: TextTemplate = {
    preset: 'karaoke', duration: previous?.duration ?? clip.duration, offset: previous?.offset ?? 0,
    ...(previous?.wordTimings ? { wordTimings: previous.wordTimings } : {}),
    highlightColor: preset.highlight ?? preset.color, karaokeStyle: preset.legacy ?? 'pop',
  };
  const stored: ClipCaptionPreset = { id, ...(tuning.popScale !== undefined ? { popScale: tuning.popScale } : {}), ...(tuning.popDuration !== undefined ? { popDuration: tuning.popDuration } : {}) };
  const textGradient: TextGradient | undefined = preset.gradient ? { colors: [...preset.gradient], angle: 90 } : undefined;
  return { fontFamily: preset.font, fontSize: preset.fontSize, color: preset.color, background: preset.box?.color ?? 'transparent', blendMode: 'normal' as const, animation: 'none' as const, textStyle, textGradient, textTemplate, captionPreset: stored };
}
