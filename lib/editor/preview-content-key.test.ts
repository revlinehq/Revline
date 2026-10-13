import { expect, test } from 'vitest';
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
