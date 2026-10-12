import { describe, expect, it } from 'vitest';
import { addMediaClip, deleteClip, duplicateClip, patchClip, placeOnFreeLayer, splitClip } from './operations';
import { moveSelectedClips, moveSelectionToNewLayers, resizeSelectedClips } from './timeline-controls';
import { EMPTY_TIMELINE, type MediaAsset } from './types';

const video = { _id: 'source', kind: 'video' as const, duration: 10, audioAssetId: 'sound' };
const assets: MediaAsset[] = [
  { ...video, fileName: 'source.mp4', url: 'https://example.com/source.mp4' },
  { _id: 'sound', kind: 'audio', duration: 10, fileName: 'source.m4a', url: 'https://example.com/source.m4a' },
];
const pair = () => addMediaClip(EMPTY_TIMELINE, video, 'video', 2);
describe('linked source audio', () => {
  it('adds a muted video and its original audio once, on V1 and A1', () => {
    const t = pair();
    expect(t.clips).toHaveLength(2);
    expect(t.clips[0]).toMatchObject({ id: 'video', kind: 'video', track: 1, volume: 0, linkedClipId: 'video-audio', audioSeparated: true });
    expect(t.clips[1]).toMatchObject({ id: 'video-audio', kind: 'audio', assetId: 'sound', track: 1, start: 2, duration: 10, volume: 1, linkedClipId: 'video' });
  });
  it('keeps silent videos and unrelated audio as single clips', () => {
    expect(addMediaClip(EMPTY_TIMELINE, { _id: 'silent', kind: 'video', duration: 4 }, 'silent').clips).toHaveLength(1);
    expect(addMediaClip(EMPTY_TIMELINE, assets[1], 'music').clips).toHaveLength(1);
  });
  it('moves both in time while changing only the dragged group’s track', () => {
    const t = moveSelectedClips(pair(), ['video'], 1, 1, 'above', 'video');
    expect(t.clips.map(c => [c.start, c.track])).toEqual([[3, 2], [3, 1]]);
    const added = moveSelectionToNewLayers(pair(), ['video'], 1, 'above', 'video');
    expect(added.clips.map(c => [c.start, c.track])).toEqual([[3, 2], [3, 1]]);
  });
  it('trims both against source limits and keeps inspector edits synchronized', () => {
    const trimmed = resizeSelectedClips(pair(), assets, ['video'], 'left', 1);
    expect(trimmed.clips.map(c => [c.start, c.duration, c.sourceStart])).toEqual([[3, 9, 1], [3, 9, 1]]);
    const patched = patchClip(pair(), 'video', { start: 4, duration: 6, sourceStart: 2, volume: .5 });
    expect(patched.clips.map(c => [c.start, c.duration, c.sourceStart, c.volume])).toEqual([[4, 6, 2, 0], [4, 6, 2, .5]]);
  });
  it('keeps AI placement and source trims linked without muting the audio', () => {
    const t = pair();
    const next = placeOnFreeLayer(t, { ...t.clips[0], start: 4, duration: 6, sourceStart: 2 });
    expect(next.clips.map(c => [c.start, c.duration, c.sourceStart, c.volume])).toEqual([[4, 6, 2, 0], [4, 6, 2, 1]]);
  });
  it('splits and duplicates complete pairs with fresh reciprocal links', () => {
    const split = splitClip(pair(), 'video', 5, 'tail');
    expect(split.clips).toHaveLength(4);
    expect(split.clips.find(c => c.id === 'tail')).toMatchObject({ linkedClipId: 'tail-audio', start: 5, sourceStart: 3, duration: 7 });
    expect(split.clips.find(c => c.id === 'tail-audio')).toMatchObject({ linkedClipId: 'tail', start: 5, sourceStart: 3, duration: 7 });
    const copy = duplicateClip(pair(), 'video', 'copy');
    expect(copy.clips).toHaveLength(4);
    expect(copy.clips.find(c => c.id === 'copy-audio')).toMatchObject({ start: 12, linkedClipId: 'copy' });
    expect(deleteClip(pair(), 'video').clips).toHaveLength(0);
  });
});
