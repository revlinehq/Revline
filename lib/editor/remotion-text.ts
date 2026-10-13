import { textStyle } from './text-style';

export const REMOTION_TEXT_PRESETS = ['word-reveal', 'word-pop', 'slide-title', 'karaoke'] as const;
export type RemotionTextPreset = typeof REMOTION_TEXT_PRESETS[number];
export type RemotionTextTemplate = { preset: RemotionTextPreset; highlightColor?: string; duration?: number; offset?: number };
export const REMOTION_TEXT_LABELS: Record<RemotionTextPreset, string> = {
  'word-reveal': 'Word reveal', 'word-pop': 'Pop-in words', 'slide-title': 'Sliding title', karaoke: 'Karaoke',
};
export const DEFAULT_TEXT_HIGHLIGHT = '#F5CF45';
export type RemotionTextProps = {
  preset: RemotionTextPreset; text: string; frame: number; fps: number; durationInFrames: number;
  color: string; fontSize: number; highlightColor: string;
};
export type RemotionTextSource = { id: string; start: number; offset: number; props: Omit<RemotionTextProps, 'frame'> };
type TextTemplateClip = {
  kind: string; start: number; duration: number; text?: string; color?: string; fontSize?: number; textTemplate?: RemotionTextTemplate;
};

export function validateRemotionTextTemplate(clip: Pick<TextTemplateClip, 'kind' | 'textTemplate'>) {
  const template = clip.textTemplate;
  if (template === undefined) return;
  if (clip.kind !== 'caption' && clip.kind !== 'graphic') throw new Error('Text templates apply to captions and text graphics only.');
  if (!template || !REMOTION_TEXT_PRESETS.includes(template.preset)) throw new Error('Choose a supported text template.');
  if (template.highlightColor !== undefined && !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(template.highlightColor)) throw new Error('Text highlight color must be a hex color.');
  if (template.duration !== undefined && (!Number.isFinite(template.duration) || template.duration <= 0)) throw new Error('Text template duration must be finite and positive.');
  if (template.offset !== undefined && !Number.isFinite(template.offset)) throw new Error('Text template offset must be finite.');
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
    highlightColor: template.highlightColor ?? DEFAULT_TEXT_HIGHLIGHT,
  };
}

export function remotionTextSources(clips: TextTemplateClip[], fps: number, resolution = 1080): RemotionTextSource[] {
  return clips.flatMap((clip, index) => {
    const input = remotionTextProps(clip, clip.start, fps, resolution);
    if (!input) return [];
    const { frame: _frame, ...props } = input;
    return [{ id: `clip-${index}`, start: clip.start, offset: clip.textTemplate?.offset ?? 0, props }];
  });
}
