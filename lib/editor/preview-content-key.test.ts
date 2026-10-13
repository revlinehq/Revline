import { expect, test } from 'vitest';
import { DEFAULT_COLOR_GRADE, DEFAULT_INVERT, DEFAULT_ZOOM_BLUR, DEFAULT_GLITCH } from './visual-effects';
import { previewContentKey } from './preview-content-key';
import { EMPTY_TIMELINE, type MediaAsset } from './types';
const timeline = { ...EMPTY_TIMELINE, clips: [{ id: 'v', kind: 'video' as const, assetId: 'source', start: 0, duration: 2, sourceStart: 0 }] };
const asset: MediaAsset = { _id: 'source', kind: 'video', fileName: 'source.mp4', width: 1920, height: 1080, url: 'https://media.example/read?token=old' };

test('analysis, waveforms, upload metadata and unused sources never invalidate the preview', () => {
  const key = previewContentKey(timeline, [asset]);
  expect(previewContentKey(timeline, [{ ...asset, fileName: 'Renamed.mp4', url: 'https://media.example/read?token=fresh', analysis: { transcript: { segments: [{ start: 0, end: 1, text: 'Transcribed' }], words: [] } } }, { ...asset, _id: 'unused', url: '/other.mp4' }])).toBe(key);
  expect(previewContentKey({ ...timeline, tracks: { visual: 5, audio: 2, overlay: 0 }, clips: [{ ...timeline.clips[0], volume: 0.5, track: 2 }] }, [asset])).toBe(key);
  expect(previewContentKey({ ...timeline, markers: [{ id: 'drop', time: 1, label: 'Beat drop' }] }, [asset])).toBe(key);
});
test('cuts, transforms, source dimensions and actual media URLs invalidate rendered content', () => {
  const key = previewContentKey(timeline, [asset]);
  expect(previewContentKey({ ...timeline, clips: [{ ...timeline.clips[0], sourceStart: 1 }] }, [asset])).not.toBe(key);
  expect(previewContentKey({ ...timeline, clips: [{ ...timeline.clips[0], transform: { x: .5, y: .5, scale: 2, rotation: 0, opacity: 1 } }] }, [asset])).not.toBe(key);
  expect(previewContentKey(timeline, [{ ...asset, width: 1080 }])).not.toBe(key);
  expect(previewContentKey(timeline, [{ ...asset, url: '/new.mp4' }])).not.toBe(key);
});

test('moving footage above or below an effect rebuilds the composition hierarchy', () => {
  const adjusted = { ...timeline, clips: [...timeline.clips, { id: 'flash', kind: 'effect' as const, track: 2, start: 1, duration: .5, sourceStart: 0, effectPreset: 'flash' as const }] };
  const key = previewContentKey(adjusted, [asset]);
  expect(previewContentKey({ ...adjusted, clips: adjusted.clips.map(clip => clip.id === 'v' ? { ...clip, track: 3 } : clip) }, [asset])).not.toBe(key);
  expect(previewContentKey({ ...adjusted, markers: [{ id: 'drop', time: 1 }] }, [asset])).toBe(key);
});

test('text content, style and animation edits keep decoded media while timing changes rebuild', () => {
  const caption = { id: 'caption', kind: 'caption' as const, start: 0, duration: 2, sourceStart: 0, text: 'Hello' };
  const original = { ...timeline, clips: [...timeline.clips, caption] };
  const key = previewContentKey(original, [asset]);
  expect(previewContentKey({ ...original, clips: [timeline.clips[0], { ...caption, animation: 'rise' }] }, [asset])).toBe(key);
  expect(previewContentKey({ ...original, clips: [timeline.clips[0], { ...caption, motion: [{ time: 0, x: 0, y: 0, scale: 1.2, rotation: 0, opacity: 1, brightness: 1 }], motionOffset: .5 }] }, [asset])).toBe(key);
  expect(previewContentKey({ ...original, clips: [timeline.clips[0], { ...caption, text: 'New words', color: '#F00', fontSize: 80, background: '#000', x: .25, y: .5, blendMode: 'screen', textTemplate: { preset: 'word-pop' } }] }, [asset])).toBe(key);
  expect(previewContentKey({ ...original, clips: [timeline.clips[0], { ...caption, start: 1 }] }, [asset])).not.toBe(key);
});


test('live color, zoom blur, glitch and inversion settings keep the media document', () => {
  const key = previewContentKey(timeline, [asset]);
  const clip = { ...timeline.clips[0], invert: { ...DEFAULT_INVERT, enabled: true }, colorGrade: { ...DEFAULT_COLOR_GRADE, enabled: true, exposure: 1 }, zoomBlur: { ...DEFAULT_ZOOM_BLUR, enabled: true }, glitch: { ...DEFAULT_GLITCH, enabled: true } };
  expect(previewContentKey({ ...timeline, clips: [clip] }, [asset])).toBe(key);
  expect(previewContentKey({ ...timeline, clips: [{ ...clip, glitch: { ...clip.glitch, intensity: .9 } }] }, [asset])).toBe(key);
});
