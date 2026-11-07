import { DEFAULT_COLOR_GRADE } from './visual-effects';
import { DEFAULT_OUTLINE } from './clip-outline';
import { deriveTrackCounts, dimensions, layerGroup, maxTrackCount, normalizeTimeline, trackOf, type Clip, type Timeline } from './types';

/** One-shot looks built from a clip and its transparent cut-out: the original stays
 * underneath (keeping its audio) and the cut-out is stacked above in exact sync. */
const CUTOUT_EFFECTS = ['text-behind', 'backdrop', 'outline', 'color-pop', 'spotlight', 'blur'] as const;
export type CutoutEffectKind = typeof CUTOUT_EFFECTS[number];
export type CutoutEffect = { kind: CutoutEffectKind; text?: string; color?: string };

export const CUTOUT_EFFECT_INFO: Record<CutoutEffectKind, { label: string; description: string; target: 'person' | 'object' }> = {
  'text-behind': { label: 'Text behind you', description: 'A big title between your background and you.', target: 'person' },
  backdrop: { label: 'Visuals behind you', description: 'Replaces your background with an animated gradient scene.', target: 'person' },
  outline: { label: 'Outline glow', description: 'A neon stroke and glow that follows your silhouette.', target: 'person' },
  'color-pop': { label: 'Colour pop', description: 'Background in black and white, you stay in colour.', target: 'person' },
  spotlight: { label: 'Spotlight object', description: 'Dims the background and keeps the salient foreground bright.', target: 'object' },
  blur: { label: 'Blur object', description: 'Blurs the salient foreground. For a specific face or logo, use a tracked mask.', target: 'object' },
};

export function validateCutoutEffect(effect: CutoutEffect) {
  if (!CUTOUT_EFFECTS.includes(effect.kind)) throw new Error('Unknown cut-out effect.');
  if (effect.text !== undefined && (typeof effect.text !== 'string' || !effect.text.trim() || effect.text.length > 80)) throw new Error('Effect text must be 1-80 characters.');
  if (effect.color !== undefined && !/^#[\da-f]{6}$/i.test(effect.color)) throw new Error('Effect color must be a six-digit hex color.');
}

/** Moves every V-group clip above `track` up by `count`, leaving those rows empty. */
export function openLayersAbove(timeline: Timeline, track: number, count: number): Timeline {
  const tracks = deriveTrackCounts(timeline);
  if (tracks.visual + count > maxTrackCount('visual')) throw new Error(`This effect needs ${count} more V tracks; remove an empty track first.`);
  const clips = timeline.clips.map(clip => layerGroup(clip.kind) === 'visual' && trackOf(clip) > track ? { ...clip, track: trackOf(clip) + count } : clip);
  return { ...timeline, clips, tracks: { ...tracks, visual: tracks.visual + count } };
}

export function applyCutoutEffect(input: Timeline, clipId: string, cutoutAssetId: string, effect: CutoutEffect, newId: () => string): Timeline {
  validateCutoutEffect(effect);
  const timeline = normalizeTimeline(input);
  const clip = timeline.clips.find(item => item.id === clipId);
  if (!clip || clip.kind !== 'video') throw new Error('Choose a video clip for this effect.');
  const track = trackOf(clip);
  // A silent, unlinked copy on the cut-out media: same timing, framing and motion, so it overlays exactly.
  // audioSeparated marks its sound as handled, so the editor does not attach another audio clip to it.
  const { linkedClipId: _linked, transition: _transition, audio: _audio, audioFadeTiming: _fade, outline: _outline, ...visual } = clip;
  const copy = (layer: number, extra: Partial<Clip> = {}): Clip => ({ ...visual, id: newId(), assetId: cutoutAssetId, track: layer, volume: 0, audioSeparated: true, ...extra });
  const grade = (patch: Partial<typeof DEFAULT_COLOR_GRADE>) => ({ ...DEFAULT_COLOR_GRADE, ...clip.colorGrade, ...patch, enabled: true });
  const withClips = (base: Timeline, update: (clips: Clip[]) => Clip[]): Timeline => {
    const next = { ...base, clips: update(base.clips) };
    return { ...next, tracks: deriveTrackCounts(next) };
  };
  const timing = { start: clip.start, duration: clip.duration, sourceStart: 0 };
  switch (effect.kind) {
    case 'text-behind': {
      const opened = openLayersAbove(timeline, track, 2);
      const text = effect.text?.trim() || 'BEHIND ME';
      // One line across ~90% of the frame: bold caps run about 0.62em per character.
      const fontSize = Math.max(48, Math.min(190, Math.floor(dimensions(timeline.aspectRatio).width * .9 / (.62 * text.length))));
      const title: Clip = { id: newId(), kind: 'graphic', track: track + 1, ...timing, text, fontSize, color: effect.color ?? '#FFFFFF', background: 'transparent', x: .5, y: .3, animation: 'rise' };
      return withClips(opened, clips => [...clips, title, copy(track + 2)]);
    }
    case 'backdrop': {
      // The clip itself becomes the cut-out (keeping its linked audio); the scene fills its old row.
      const opened = openLayersAbove(timeline, track, 1);
      const scene: Clip = { id: newId(), kind: 'scene', track, ...timing, scene: { title: 'Gradient backdrop', code: BACKDROP_SCENE } };
      return withClips(opened, clips => [...clips.map(item => item.id === clip.id ? { ...item, assetId: cutoutAssetId, track: track + 1 } : item), scene]);
    }
    case 'outline':
      return withClips(openLayersAbove(timeline, track, 1), clips => [...clips, copy(track + 1, { outline: { ...DEFAULT_OUTLINE, color: effect.color ?? DEFAULT_OUTLINE.color } })]);
    case 'color-pop':
      return withClips(openLayersAbove(timeline, track, 1), clips => [...clips.map(item => item.id === clip.id ? { ...item, colorGrade: grade({ saturation: 0 }) } : item), copy(track + 1)]);
    case 'spotlight':
      return withClips(openLayersAbove(timeline, track, 1), clips => [...clips.map(item => item.id === clip.id ? { ...item, colorGrade: grade({ exposure: -1.3 }) } : item), copy(track + 1, { outline: { enabled: true, color: effect.color ?? '#FFFFFF', width: 0, glow: 22 } })]);
    case 'blur':
      return withClips(openLayersAbove(timeline, track, 1), clips => [...clips, copy(track + 1, { softBlur: { enabled: true, amount: 28 } })]);
  }
}

/** Slow drifting colour fields; cheap radial gradients rather than CSS blur filters. */
const BACKDROP_SCENE = `const FIELDS = [
  ['#ff4d8d', 0.2, 0.25, 0.8, 3.1, 2.6],
  ['#5b6cff', 0.8, 0.3, 0.9, 2.5, 3.4],
  ['#22d3ee', 0.35, 0.8, 0.85, 3.7, 2.3],
  ['#ffb347', 0.85, 0.85, 0.7, 2.8, 3.0],
] as const;

export default function scene({ root, tl, width, height }) {
  const size = Math.max(width, height);
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;background:#0b0b14;overflow:hidden';
  root.appendChild(stage);
  for (const [color, x, y, radius, driftX, driftY] of FIELDS) {
    const diameter = size * radius;
    const field = document.createElement('div');
    field.style.cssText = \`position:absolute;left:\${width * x - diameter / 2}px;top:\${height * y - diameter / 2}px;width:\${diameter}px;height:\${diameter}px;border-radius:50%;background:radial-gradient(circle, \${color} 0%, transparent 65%);opacity:0.85\`;
    stage.appendChild(field);
    tl.fromTo(field, { x: -0.12 * width }, { x: 0.12 * width, duration: driftX, ease: 'sine.inOut', repeat: -1, yoyo: true }, 0)
      .fromTo(field, { y: 0.1 * height }, { y: -0.1 * height, duration: driftY, ease: 'sine.inOut', repeat: -1, yoyo: true }, 0);
  }
}
`;
