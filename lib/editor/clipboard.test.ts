import { describe, expect, it } from 'vitest';
import { copyTimelineClips, pasteTimelineClips } from './clipboard';
import type { Timeline } from './types';

const timeline: Timeline = { fps: 30, aspectRatio: 'vertical', tracks: { visual: 2, overlay: 0, audio: 1 }, clips: [
  { id: 'video', kind: 'video', track: 1, assetId: 'footage', start: 2, duration: 3, sourceStart: 4, audioSeparated: true, volume: 0, linkedClipId: 'audio', transform: { x: .5, y: .5, scale: 1.2, rotation: 0, opacity: 1 } },
  { id: 'audio', kind: 'audio', track: 1, assetId: 'sound', start: 2, duration: 3, sourceStart: 4, volume: .6, linkedClipId: 'video' },
  { id: 'caption', kind: 'caption', track: 2, start: 3, duration: 1, sourceStart: 0, text: 'Opening' },
] };
let sequence = 0;
const newId = () => `copy-${++sequence}`;

describe('timeline clipboard', () => {
  it('copies a linked pair and keeps an independent snapshot after source edits', () => {
    const copy = copyTimelineClips(timeline, ['video']);
    expect(copy.map(clip => clip.id)).toEqual(['video', 'audio']);
    copy[0].transform!.scale = 2;
    expect(timeline.clips[0].transform!.scale).toBe(1.2);
  });
  it('pastes at a frame-aligned playhead with new links, source offsets, and relative caption timing', () => {
    const copied = copyTimelineClips(timeline, ['video', 'caption']);
    const result = pasteTimelineClips(timeline, copied, 10.017, newId);
    const clips = result.timeline.clips.filter(clip => result.ids.includes(clip.id));
    expect(clips.map(clip => clip.start)).toEqual([10 + 1/30, 10 + 1/30, 11 + 1/30]);
    expect(clips[0]).toMatchObject({ assetId: 'footage', sourceStart: 4, volume: 0, linkedClipId: clips[1].id });
    expect(clips[1]).toMatchObject({ sourceStart: 4, volume: .6, linkedClipId: clips[0].id });
    expect(result.timeline.clips.slice(0, 3)).toEqual(timeline.clips);
    expect(pasteTimelineClips(result.timeline, copied, 15, newId).ids).not.toEqual(result.ids);
  });
  it('uses free compatible layers at an occupied paste position and leaves originals intact', () => {
    const result = pasteTimelineClips(timeline, copyTimelineClips(timeline, ['video']), 2, newId);
    expect(result.timeline.clips.slice(0, 3)).toEqual(timeline.clips);
    expect(result.timeline.clips.filter(clip => result.ids.includes(clip.id)).map(clip => clip.track)).toEqual([3, 2]);
  });
  it('rejects an overlong paste atomically without adding clips', () => {
    expect(pasteTimelineClips(timeline, copyTimelineClips(timeline, ['video']), 299, newId).timeline.clips.at(-1)?.start).toBe(299);
    expect(timeline.clips).toHaveLength(3);
    expect(pasteTimelineClips(timeline, [], 1, newId)).toEqual({ timeline, ids: [] });
  });
});
