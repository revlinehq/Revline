import type { TextGradient } from './text-gradient';
import { textStyle, type TextAppearance } from './text-style';
import type { TextFontId } from './text-fonts';

export const VFX_TEXT_PRESETS = ['neon-echo', 'lyric-slam', 'kinetic-stack'] as const;
export const EXPRESSIVE_TEXT_PRESETS = ['rgb-split', 'type-trails', 'blur-focus', 'character-scramble', 'spotlight-sweep', 'ink-write', 'tunnel-zoom'] as const;
export type ExpressiveTextPreset = typeof EXPRESSIVE_TEXT_PRESETS[number];
export const REMOTION_TEXT_PRESETS = ['word-reveal', 'word-pop', 'slide-title', 'karaoke', ...VFX_TEXT_PRESETS, ...EXPRESSIVE_TEXT_PRESETS] as const;
export type RemotionTextPreset = typeof REMOTION_TEXT_PRESETS[number];
export type WordTiming = { start: number; end: number };
export const EXPRESSIVE_TEXT_DEFAULTS = { strength: 1, revealDuration: .65, stagger: .07 } as const;
const EXPRESSIVE_TEXT_LIMITS = { strength: [.2, 2], revealDuration: [.15, 3], stagger: [0, .18] } as const;
/** Karaoke with speech timings: `box` fills the active word with a highlight pill (default); `pop` keeps the outline,
 * colors the active word and pops each word in as it is spoken (clipper captions). */
export type KaraokeStyle = 'box' | 'pop';
export type RemotionTextTemplate = { preset: RemotionTextPreset; highlightColor?: string; duration?: number; offset?: number; wordTimings?: WordTiming[]; karaokeStyle?: KaraokeStyle; strength?: number; revealDuration?: number; stagger?: number };
export const REMOTION_TEXT_LABELS: Record<RemotionTextPreset, string> = {
  'word-reveal': 'Word reveal', 'word-pop': 'Pop-in words', 'slide-title': 'Sliding title', karaoke: 'Karaoke',
  'neon-echo': 'Neon echo', 'lyric-slam': 'Lyric slam', 'kinetic-stack': 'Kinetic stack',
  'rgb-split': 'Chromatic split', 'type-trails': 'Outline trails', 'blur-focus': 'Cinematic focus', 'character-scramble': 'Character scramble',
  'spotlight-sweep': 'Spotlight sweep', 'ink-write': 'Ink write-on',
  'tunnel-zoom': 'Echo tunnel',
};
export const REMOTION_TEXT_DESCRIPTIONS: Record<RemotionTextPreset,string> = {
  "word-reveal": "Reveal words sequentially with a short fade and upward settle; appearance remains independently editable.",
  "word-pop": "Bring words in one by one with a spring scale and fade, preserving their positions and chosen appearance.",
  "slide-title": "Slide the entire title horizontally into place with a smooth fade; keeps the text layout intact.",
  "karaoke": "Highlight one word at a time. Supplied speech timings drive a stable active-word highlight and small pop; otherwise words use even progress across the clip duration.",
  "neon-echo": "Spring the text in with offset drifting outline echoes, a subtle hold pulse and an upward fading exit; colors/stroke/glow remain editable separately.",
  "lyric-slam": "Punch the whole text in with a spring squash/stretch and slight rotation, then snap it upward on exit; does not generate lyrics.",
  "kinetic-stack": "Stagger words with individual spring scale and vertical/rotational movement, hold the phrase, then lift and fade it out.",
  'rgb-split': 'Separate accent and pink chromatic channels, then converge on crisp words. Strength, reveal duration and word stagger stay editable.',
  'type-trails': 'Move a filled title into place with fine accent-colored outline echoes that catch up and disappear. Strength, reveal duration and echo spacing stay editable.',
  'blur-focus': 'Pull blurred, widely spaced words into sharp focus. Each word reserves its resting width, so the text keeps the same line breaks throughout the animation.',
  'character-scramble': 'Roll deterministic characters from left to right, resolving into the exact original text. Letter widths and line breaks stay fixed.',
  'spotlight-sweep': 'Reveal a title from the dark while a band of accent light sweeps across its lettering. The same resting text determines layout throughout.',
  'ink-write': 'Write accent-colored outlines across each word, followed by the filled lettering. Strength, reveal duration and word stagger remain editable.',
  'tunnel-zoom': 'Move concentric accent outlines through a perspective tunnel and resolve into one crisp title. Strength controls the depth; the original words and layout stay intact.',
};
export const VFX_TEXT_APPEARANCE: Partial<Record<RemotionTextPreset, { color: string; highlightColor: string }>> = {
  'neon-echo': { color: '#B72CFF', highlightColor: '#FF962E' },
  'lyric-slam': { color: '#FFF3E1', highlightColor: '#FF6E36' },
  'kinetic-stack': { color: '#F8F2FF', highlightColor: '#BA83FF' },
};
export const DEFAULT_TEXT_HIGHLIGHT = '#F5CF45';
export type RemotionTextProps = {
  preset: RemotionTextPreset; text: string; frame: number; fps: number; durationInFrames: number;
  color: string; fontSize: number; highlightColor: string;
  textGradient?: TextGradient; gradientTime?: number;
  textStyle?: TextAppearance; fontFamily?: string; fontWeight?: number; resolution?: number;
  wordTimings?: WordTiming[]; karaokeStyle?: KaraokeStyle;
  strength?: number; revealDuration?: number; stagger?: number;
};
export type RemotionTextSource = { id: string; start: number; offset: number; props: Omit<RemotionTextProps, 'frame'> };
type TextTemplateClip = {
  kind: string; start: number; duration: number; text?: string; color?: string; fontSize?: number; textTemplate?: RemotionTextTemplate;
  textStyle?: TextAppearance; fontFamily?: TextFontId; textGradient?: TextGradient;
};

export function validateRemotionTextTemplate(clip: Pick<TextTemplateClip, 'kind' | 'textTemplate'> & {text?: string; duration?: number}) {
  const template = clip.textTemplate;
  if (template === undefined) return;
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Text templates apply to captions and text graphics only.');
  if (!template || !REMOTION_TEXT_PRESETS.includes(template.preset)) throw new Error('Choose a supported text template.');
  if (template.highlightColor !== undefined && !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(template.highlightColor)) throw new Error('Text highlight color must be a hex color.');
  if (template.duration !== undefined && (!Number.isFinite(template.duration) || template.duration <= 0)) throw new Error('Text template duration must be finite and positive.');
  if (template.offset !== undefined && !Number.isFinite(template.offset)) throw new Error('Text template offset must be finite.');
  for (const [key, [min, max]] of Object.entries(EXPRESSIVE_TEXT_LIMITS)) {
    const value = template[key as keyof typeof EXPRESSIVE_TEXT_LIMITS];
    if (value !== undefined && (!Number.isFinite(value) || value < min || value > max)) throw new Error(`Text animation ${key} must be between ${min} and ${max}.`);
  }
  if(template.karaokeStyle!==undefined&&(template.preset!=='karaoke'||!['box','pop'].includes(template.karaokeStyle)))throw new Error('Karaoke style applies to the karaoke template and must be box or pop.');
  if(template.wordTimings!==undefined){
    const words=(clip.text??'').trim().split(/\s+/).filter(Boolean),duration=template.duration??clip.duration??Infinity;
    if(template.preset!=='karaoke'||!words.length||words.length>500||!Array.isArray(template.wordTimings)||template.wordTimings.length!==words.length||template.wordTimings.some((word,i)=>!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<0||word.end<word.start||word.end>duration+1e-6||(i>0&&word.start<template.wordTimings![i-1].end-1e-6)))throw new Error('Speech timings must match the karaoke words, stay ordered, and fit the original text duration.');
  }
}

/** Negative offsets preserve the original entrance when extending a text clip to the left. */
export function textTemplateTimingPatch(clip: Pick<TextTemplateClip, 'duration' | 'textTemplate'>, delta = 0): { textTemplate?: RemotionTextTemplate } {
  return clip.textTemplate ? { textTemplate: { ...clip.textTemplate, duration: clip.textTemplate.duration ?? clip.duration, offset: (clip.textTemplate.offset ?? 0) + delta } } : {};
}

/** Frozen template duration and offset retain word timing when a text clip is split or trimmed. */
export function remotionTextProps(clip: TextTemplateClip, time: number, fps: number, resolution = 1080): RemotionTextProps | null {
  if (!clip.textTemplate) return null;
  validateRemotionTextTemplate(clip);
  if (![time, fps, resolution, clip.start, clip.duration].every(Number.isFinite) || fps <= 0 || resolution <= 0 || clip.duration <= 0) throw new Error('Text template rendering needs valid timing and dimensions.');
  const template = clip.textTemplate;
  const style = textStyle(clip, resolution);
  return {
    preset: template.preset, text: style.text,
    frame: Math.floor((time - clip.start + (template.offset ?? 0) + 1e-7) * fps),
    fps, durationInFrames: Math.max(1, Math.ceil(((template.duration ?? clip.duration) - 1e-7) * fps)),
    color: style.color, fontSize: style.fontSize,
    ...(clip.textGradient ? {textGradient:clip.textGradient,gradientTime:time-clip.start} : {}),
    textStyle: clip.textStyle, fontFamily: style.fontFamily, fontWeight: style.fontWeight, resolution,
    highlightColor: template.highlightColor ?? VFX_TEXT_APPEARANCE[template.preset]?.highlightColor ?? DEFAULT_TEXT_HIGHLIGHT,
    ...(template.strength !== undefined ? { strength: template.strength } : {}),
    ...(template.revealDuration !== undefined ? { revealDuration: template.revealDuration } : {}),
    ...(template.stagger !== undefined ? { stagger: template.stagger } : {}),
    ...(template.wordTimings?{wordTimings:template.wordTimings}:{}),
    ...(template.karaokeStyle?{karaokeStyle:template.karaokeStyle}:{}),
  };
}
