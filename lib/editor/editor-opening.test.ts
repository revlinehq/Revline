import { expect, test } from 'vitest';
import { editorAudioPrepared } from './editor-opening';
import { EMPTY_TIMELINE, type MediaAsset } from './types';

test('opening waits for extraction, the linked audio clip and its waveform', () => {
  const video: MediaAsset = { _id: 'video', kind: 'video', fileName: 'phone.mp4', url: '/video.mp4' };
  const timeline = { ...EMPTY_TIMELINE, clips: [{ id: 'v', kind: 'video' as const, assetId: 'video', start: 0, duration: 176, sourceStart: 0 }] };
  expect(editorAudioPrepared(timeline, [video])).toBe(false);
  expect(editorAudioPrepared(timeline, [{ ...video, audioExtracted: true }])).toBe(true);
  const prepared = { ...video, audioExtracted: true, audioAssetId: 'audio' };
  expect(editorAudioPrepared(timeline, [prepared])).toBe(false);
  const linked = { ...timeline, clips: [{ ...timeline.clips[0], audioSeparated: true, linkedClipId: 'a' }, { id: 'a', kind: 'audio' as const, assetId: 'audio', start: 0, duration: 176, sourceStart: 0 }] };
  const audio: MediaAsset = { _id: 'audio', kind: 'audio', fileName: 'phone.m4a', url: '/audio.m4a' };
  expect(editorAudioPrepared(linked, [prepared, audio])).toBe(false);
  expect(editorAudioPrepared(linked, [prepared, { ...audio, waveform: { peaks: 'gP8=', samplesPerSecond: 1 } }])).toBe(true);
});
