import { expect, test } from 'vitest';
import { DEFAULT_COLOR_GRADE, DEFAULT_GLITCH, DEFAULT_ZOOM_BLUR, validateVisualEffects, visualEffectsPatch, type VisualEffects } from './visual-effects';
import { addMediaClip, duplicateClip, patchClip, splitClip } from './operations';
import { copyTimelineClips, pasteTimelineClips } from './clipboard';
import { EMPTY_TIMELINE } from './types';

const effects: VisualEffects = { colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: .5 }, zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true }, glitch: { ...DEFAULT_GLITCH, enabled: true } };
test('defaults are bypassed and requested controls merge without resetting existing controls', () => {
  expect(DEFAULT_COLOR_GRADE.enabled || DEFAULT_ZOOM_BLUR.enabled || DEFAULT_GLITCH.enabled).toBe(false);
  expect(visualEffectsPatch({ kind: 'video', ...effects }, { colorGrade: { contrast: 1.3 } })).toEqual({ colorGrade: { ...effects.colorGrade, contrast: 1.3 } });
  expect(visualEffectsPatch({ kind: 'image' }, { zoomBlur: { enabled: true } })).toEqual({ zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true } });
  expect(() => visualEffectsPatch({ kind: 'video' }, {})).toThrow('at least one');
});
test('non-media kinds, nonfinite controls and out-of-range values are rejected even when bypassed', () => {
  for (const kind of ['audio', 'caption', 'graphic', 'effect'] as const) expect(() => validateVisualEffects({ kind, ...effects })).toThrow('video or image');
  for (const exposure of [Infinity, NaN, -2.1, 2.1]) expect(() => validateVisualEffects({ kind: 'video', colorGrade: { ...DEFAULT_COLOR_GRADE, exposure } })).toThrow('colorGrade.exposure');
  expect(() => validateVisualEffects({ kind: 'video', zoomBlur: { ...DEFAULT_ZOOM_BLUR, centerX: 2 } })).toThrow('centerX');
  expect(() => validateVisualEffects({ kind: 'video', glitch: { ...DEFAULT_GLITCH, blockSize: 0 } })).toThrow('blockSize');
  expect(() => validateVisualEffects({ kind: 'video', glitch: { ...DEFAULT_GLITCH, rgbSplit: 51 } })).toThrow('rgbSplit');
});
test('split, duplicate and clipboard preserve grading and effects without copying them to linked audio', () => {
  const timeline = patchClip(addMediaClip(EMPTY_TIMELINE, { _id: 'source', kind: 'video', duration: 10, audioAssetId: 'audio' }, 'video'), 'video', effects);
  const split = splitClip(timeline, 'video', 3, 'tail');
  for (const clip of split.clips.filter(clip => clip.kind === 'video')) expect(clip).toMatchObject(effects);
  const duplicated = duplicateClip(split, 'tail', 'duplicate');
  expect(duplicated.clips.find(clip => clip.id === 'duplicate')).toMatchObject(effects);
  const copied = copyTimelineClips(split, ['tail']);
  let id = 0;
  const pasted = pasteTimelineClips(duplicated, copied, 30, () => `copy-${++id}`).timeline;
  expect(pasted.clips.find(clip => clip.id === 'copy-1')).toMatchObject(effects);
  for (const clip of pasted.clips.filter(clip => clip.kind === 'audio')) {
    expect(clip.colorGrade).toBeUndefined(); expect(clip.zoomBlur).toBeUndefined(); expect(clip.glitch).toBeUndefined();
  }
});
