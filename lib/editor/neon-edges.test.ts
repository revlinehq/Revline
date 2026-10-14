import { expect, test } from 'vitest';
import { DEFAULT_NEON_EDGES } from './neon-edges';
import { validateVisualEffects, visualEffectsPatch } from './visual-effects';
import { addMediaClip, duplicateClip, patchClip, splitClip } from './operations';
import { EMPTY_TIMELINE } from './types';

test('Neon controls merge independently and default to bypassed', () => {
  expect(DEFAULT_NEON_EDGES.enabled).toBe(false);
  const neonEdges = { ...DEFAULT_NEON_EDGES, enabled: true, color: '#ff3a9e', detail: .3 };
  expect(visualEffectsPatch({ kind: 'video', neonEdges }, { neonEdges: { glow: 1 } })).toEqual({ neonEdges: { ...neonEdges, glow: 1 } });
  expect(visualEffectsPatch({ kind: 'image' }, { neonEdges: { enabled: true } })).toEqual({ neonEdges: { ...DEFAULT_NEON_EDGES, enabled: true } });
});

test('Neon refuses malformed shader values and non-footage targets', () => {
  for (const kind of ['audio', 'caption', 'graphic', 'effect'] as const) expect(() => validateVisualEffects({ kind, neonEdges: DEFAULT_NEON_EDGES })).toThrow('video or image');
  for (const value of [NaN, Infinity, -.1, 1.1]) for (const key of ['amount', 'detail', 'threshold', 'glow'] as const) expect(() => validateVisualEffects({ kind: 'video', neonEdges: { ...DEFAULT_NEON_EDGES, [key]: value } })).toThrow(`neonEdges.${key}`);
  for (const color of ['cyan', '#fff', '#ffffff00', '#gggggg']) expect(() => validateVisualEffects({ kind: 'image', neonEdges: { ...DEFAULT_NEON_EDGES, color } })).toThrow('six-digit hex');
  expect(() => validateVisualEffects({ kind: 'video', neonEdges: { ...DEFAULT_NEON_EDGES, arbitrary: 1 } } as Parameters<typeof validateVisualEffects>[0])).toThrow('Unknown neonEdges');
});

test('Neon survives clip edits without spreading to linked audio', () => {
  const neonEdges = { ...DEFAULT_NEON_EDGES, enabled: true };
  const timeline = patchClip(addMediaClip(EMPTY_TIMELINE, { _id: 'source', kind: 'video', duration: 4, audioAssetId: 'audio' }, 'video'), 'video', { neonEdges, invert: { enabled: true, amount: .2 } });
  const split = splitClip(timeline, 'video', 2, 'tail');
  const duplicated = duplicateClip(split, 'tail', 'copy');
  for (const clip of duplicated.clips) {
    if (clip.kind === 'video') expect(clip).toMatchObject({ neonEdges, invert: { enabled: true, amount: .2 } });
    else expect(clip.neonEdges).toBeUndefined();
  }
});
