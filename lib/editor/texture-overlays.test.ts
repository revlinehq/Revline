import { expect, test } from 'vitest';
import { DEFAULT_VHS, DEFAULT_LIGHT_LEAK, validateVisualEffects, visualEffectsOf, visualEffectsPatch } from './visual-effects';
import { addMediaClip, duplicateClip, patchClip, splitClip } from './operations';
import { resizeSelectedClips } from './timeline-controls';
import { copyTimelineClips, pasteTimelineClips } from './clipboard';
import { EMPTY_TIMELINE, normalizeTimeline } from './types';
import { visualEffectActionPatch } from './visual-effect-actions';
import { EFFECT_LIBRARY_CATALOG } from './effect-catalog';

const effects = { vhs: { ...DEFAULT_VHS, enabled: true, tracking: .7 }, lightLeak: { ...DEFAULT_LIGHT_LEAK, enabled: true, color: '#ed5f30', position: .75 } };
test('texture defaults are bypassed; partial edits, reset, removal and the Texture inventory share a contract', () => {
  expect(DEFAULT_VHS.enabled || DEFAULT_LIGHT_LEAK.enabled).toBe(false);
  expect(visualEffectsPatch({ kind: 'image' }, { vhs: { enabled: true }, lightLeak: { enabled: true } })).toEqual({ vhs: { ...DEFAULT_VHS, enabled: true }, lightLeak: { ...DEFAULT_LIGHT_LEAK, enabled: true } });
  expect(visualEffectsPatch({ kind: 'video', ...effects }, { lightLeak: { speed: 0 }, vhs: { enabled: false } })).toEqual({ lightLeak: { ...effects.lightLeak, speed: 0 }, vhs: { ...effects.vhs, enabled: false } });
  const clip = { id: 'source', kind: 'video' as const, start: 0, duration: 4, sourceStart: 0, ...effects };
  expect(visualEffectActionPatch(clip, 'vhs', 'reset')).toEqual({ vhs: { ...DEFAULT_VHS, enabled: true } });
  expect(visualEffectActionPatch(clip, 'lightLeak', 'remove')).toEqual({ lightLeak: undefined });
  expect(visualEffectsOf(clip)).toMatchObject(effects);
  for (const id of ['vhs', 'lightLeak']) expect(EFFECT_LIBRARY_CATALOG.find(entry => entry.id === id)).toMatchObject({ category: 'texture', visual: id });
});

test('all shader values validate even when bypassed and only media can receive textures', () => {
  for (const kind of ['audio', 'caption', 'graphic', 'effect', 'solid'] as const) expect(() => validateVisualEffects({ kind, ...effects })).toThrow('video or image');
  for (const key of ['amount', 'scanlines', 'noise', 'bleed', 'tracking', 'speed'] as const) for (const value of [NaN, Infinity, -.01, key === 'speed' ? 3.01 : 1.01]) expect(() => validateVisualEffects({ kind: 'video', vhs: { ...DEFAULT_VHS, [key]: value } })).toThrow(`vhs.${key}`);
  for (const key of ['amount', 'position', 'spread', 'speed'] as const) for (const value of [NaN, Infinity, -.01, key === 'speed' ? 3.01 : 1.01]) expect(() => validateVisualEffects({ kind: 'image', lightLeak: { ...DEFAULT_LIGHT_LEAK, [key]: value } })).toThrow(`lightLeak.${key}`);
  for (const color of [undefined, 'red', '#fff', '#gggggg', '#12345678']) expect(() => validateVisualEffects({ kind: 'video', lightLeak: { ...DEFAULT_LIGHT_LEAK, color } } as Parameters<typeof validateVisualEffects>[0])).toThrow('six-digit hex');
  expect(() => validateVisualEffects({ kind: 'video', vhs: { ...DEFAULT_VHS, random: 1 } } as Parameters<typeof validateVisualEffects>[0])).toThrow('Unknown vhs');
});

test('textures survive normalize, trim, split, duplicate and clipboard without reaching linked audio', () => {
  const timeline = patchClip(addMediaClip(EMPTY_TIMELINE, { _id: 'asset', kind: 'video', duration: 5, audioAssetId: 'audio' }, 'video'), 'video', effects);
  const normalized = normalizeTimeline(timeline);
  const trimmed = resizeSelectedClips(normalized, [], ['video'], 'right', -1);
  const split = splitClip(trimmed, 'video', 2, 'tail');
  const duplicated = duplicateClip(split, 'tail', 'copy');
  const copied = copyTimelineClips(duplicated, ['copy']);
  let id = 0;
  const pasted = pasteTimelineClips(duplicated, copied, 30, () => `pasted-${++id}`).timeline;
  for (const clip of pasted.clips) {
    if (clip.kind === 'video') expect(clip).toMatchObject(effects);
    else { expect(clip.vhs).toBeUndefined(); expect(clip.lightLeak).toBeUndefined(); }
  }
});
