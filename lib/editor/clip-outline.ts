import type { Clip, ClipOutline } from './types';

export const DEFAULT_OUTLINE: Readonly<ClipOutline> = Object.freeze({ enabled: true, color: '#36f9f2', width: 5, glow: 28 });
const OUTLINE_LIMITS = { width: [0, 24], glow: [0, 80] } as const;

export function validateOutline(clip: Pick<Clip, 'kind' | 'outline'>) {
  const outline = clip.outline;
  if (!outline) return;
  if (clip.kind !== 'video' && clip.kind !== 'image') throw new Error('Only video and image clips can have an outline.');
  if (typeof outline.enabled !== 'boolean' || typeof outline.color !== 'string' || !/^#[\da-f]{6}$/i.test(outline.color)) throw new Error('outline needs enabled and a six-digit hex color.');
  if (Object.keys(outline).some(key => !['enabled', 'color', 'width', 'glow'].includes(key))) throw new Error('Unknown outline control.');
  for (const [key, [min, max]] of Object.entries(OUTLINE_LIMITS)) {
    const value = outline[key as keyof typeof OUTLINE_LIMITS];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`outline.${key} must be between ${min} and ${max}.`);
  }
}

/** CSS filter for the clip frame: four hard offsets form the stroke, one soft shadow the glow. */
export function outlineFilter(outline: ClipOutline | undefined, scale: number) {
  if (!outline?.enabled) return '';
  const px = (value: number) => `${Math.round(value * scale * 100) / 100}px`;
  const stroke = outline.width > 0 ? [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => `drop-shadow(${px(x * outline.width)} ${px(y * outline.width)} 0 ${outline.color})`) : [];
  return [...stroke, ...outline.glow > 0 ? [`drop-shadow(0 0 ${px(outline.glow)} ${outline.color})`] : []].join(' ');
}
