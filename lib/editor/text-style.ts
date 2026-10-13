type TextStyleInput = {
  kind: string; text?: string; x?: number; y?: number; fontSize?: number;
  color?: string; background?: string; blendMode?: string;
};
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
const colorPattern = /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i;
const color = (value: string | undefined, fallback: string) => value && colorPattern.test(value) ? value : fallback;

/** Resolve the same text appearance for preview, templates, handles and export. */
export function textStyle(clip: TextStyleInput, resolution = 1080) {
  return {
    text: (clip.text ?? '').slice(0, 2000),
    x: bounded(clip.x, .5, 0, 1), y: bounded(clip.y, clip.kind === 'caption' ? .82 : .5, 0, 1),
    fontSize: bounded(clip.fontSize, clip.kind === 'caption' ? 52 : 92, 8, 300) * resolution / 1080,
    color: color(clip.color, '#F4F4F0'), background: color(clip.background, 'transparent'),
    blendMode: clip.blendMode ?? 'normal',
  };
}
