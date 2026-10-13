import { expect, test, vi } from 'vitest';
import { previewVisualEffects, updateLiveVisualEffects } from './live-visual-effects';
import { DEFAULT_COLOR_GRADE } from './visual-effects';
import { EMPTY_TIMELINE, type Clip } from './types';

const clip: Clip = { id: 'footage', kind: 'video', assetId: 'source', start: 0, sourceStart: 0, duration: 2 };
function documentWithRuntime() {
  const set = vi.fn();
  const document = { defaultView: { __revlineEffects: { set } } } as unknown as Document;
  return { document, set };
}

test('preview and cancel apply effect overrides without mutating the saved clip', () => {
  const { document, set } = documentWithRuntime();
  const colorGrade = { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: 1 };
  expect(previewVisualEffects(document, clip, 3, { colorGrade })).toBe(true);
  expect(set).toHaveBeenLastCalledWith('clip-3', { colorGrade, zoomBlur: undefined, glitch: undefined, invert: undefined });
  expect(clip.colorGrade).toBeUndefined();
  previewVisualEffects(document, clip, 3, null);
  expect(set).toHaveBeenLastCalledWith('clip-3', { colorGrade: undefined, zoomBlur: undefined, glitch: undefined, invert: undefined });
});

test('commits update only changed visual clips and remove disabled effects', () => {
  const { document, set } = documentWithRuntime();
  const colorGrade = { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: 1 };
  const previous = { ...EMPTY_TIMELINE, clips: [clip, { ...clip, id: 'other' }] };
  const next = { ...previous, clips: [{ ...clip, colorGrade }, previous.clips[1]] };
  expect(updateLiveVisualEffects(document, previous, next)).toBe(true);
  expect(set).toHaveBeenCalledTimes(1);
  expect(set.mock.calls[0][0]).toBe('clip-0');
  updateLiveVisualEffects(document, next, previous);
  expect(set).toHaveBeenLastCalledWith('clip-0', { colorGrade: undefined, zoomBlur: undefined, glitch: undefined, invert: undefined });
});

test('invalid shader parameters are rejected and old players reload only for changed effects', () => {
  const { document, set } = documentWithRuntime();
  expect(() => previewVisualEffects(document, clip, 0, { colorGrade: { ...DEFAULT_COLOR_GRADE, exposure: Infinity } })).toThrow();
  expect(set).not.toHaveBeenCalled();
  const oldDocument = { defaultView: {} } as Document;
  const previous = { ...EMPTY_TIMELINE, clips: [clip] };
  expect(updateLiveVisualEffects(oldDocument, previous, previous)).toBe(true);
  expect(updateLiveVisualEffects(oldDocument, previous, { ...previous, clips: [{ ...clip, colorGrade: DEFAULT_COLOR_GRADE }] })).toBe(false);
});
