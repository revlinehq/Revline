import { expect, test } from 'vitest';
import { previewContentKey } from './preview-content-key';
import { EMPTY_TIMELINE, type MediaAsset } from './types';

const timeline = { ...EMPTY_TIMELINE, clips: [{ id: 'v', kind: 'video' as const, assetId: 'source', start: 0, duration: 2, sourceStart: 0 }] };
const asset: MediaAsset = { _id: 'source', kind: 'video', fileName: 'source.mp4', width: 1920, height: 1080, url: '/source.mp4' };

test('content edits retain the preview stage', () => {
  const edited = { ...timeline, clips: [{ ...timeline.clips[0], duration: 3, sourceStart: 1, volume: .5 }] };
  expect(previewContentKey(edited, [{ ...asset, url: '/replacement.mp4' }])).toBe(previewContentKey(timeline, [asset]));
});

test('output format changes replace the stage', () => {
  const key = previewContentKey(timeline, [asset]);
  expect(previewContentKey({ ...timeline, fps: 60 }, [asset])).not.toBe(key);
  expect(previewContentKey({ ...timeline, aspectRatio: 'square' }, [asset])).not.toBe(key);
});
