import { expect, test } from 'vitest';
import { scriptedDemoPlan } from './scripted-demo';
import { generateComposition } from './composition';
import type { MediaAsset } from './types';

const video: MediaAsset = { _id: 'local-video', kind: 'video', fileName: 'Local footage.mp4', url: '/fixture.mp4', duration: 37.2, width: 1920, height: 1080 };
test('each animated build stage is a valid real composition with bounded source cuts', () => {
  const assets = [video, { ...video, _id: 'short', duration: 1 / 30, width: 1080, height: 1920 }, { _id: 'sound', kind: 'audio' as const, fileName: 'Score.wav', url: '/score.wav', duration: 4 }];
  const snapshot = structuredClone(assets), plan = scriptedDemoPlan(assets, 'Use "ONE GOOD MOMENT" as the caption', 'take');
  let clips = plan.initial.clips;
  for (const step of plan.steps) {
    clips = [...clips, ...step.clips];
    expect(() => generateComposition({ ...plan.initial, clips }, assets)).not.toThrow();
  }
  expect(clips).toEqual(plan.timeline.clips);
  for (const shot of clips.filter(clip => clip.kind === 'video')) {
    const source = assets.find(asset => asset._id === shot.assetId)!;
    expect(shot.duration).toBeGreaterThanOrEqual(1 / 30);
    expect(shot.sourceStart).toBeGreaterThanOrEqual(0);
    expect(shot.sourceStart + shot.duration).toBeLessThanOrEqual(source.duration! + 1e-6);
  }
  expect(clips.filter(clip => clip.kind === 'caption').every(clip => clip.text === 'ONE GOOD MOMENT')).toBe(true);
  expect(clips.find(clip => clip.kind === 'audio')?.duration).toBeLessThanOrEqual(4);
  expect(assets).toEqual(snapshot);
});
test('the script uses unique take IDs, caps visual work, and rejects an audio-only demo', () => {
  const many = Array.from({ length: 20 }, (_, index) => ({ ...video, _id: `video-${index}` }));
  const a = scriptedDemoPlan(many, 'Make a short edit', 'first'), b = scriptedDemoPlan(many, 'Make a short edit', 'second');
  expect(a.timeline.clips.filter(clip => clip.kind === 'video')).toHaveLength(8);
  expect(new Set(a.timeline.clips.map(clip => clip.id)).size).toBe(a.timeline.clips.length);
  expect(a.timeline.clips.some(clip => b.timeline.clips.some(other => other.id === clip.id))).toBe(false);
  expect(() => scriptedDemoPlan([{ _id: 'audio', kind: 'audio', fileName: 'Only audio', duration: 2, url: '/score.wav' }], 'Edit', 'run')).toThrow('video or image');
  expect(() => scriptedDemoPlan([{ ...video, duration: 0 }], 'Edit', 'run')).toThrow('readable');
});
