import { expect, test } from 'vitest';
import { f1RecordingDemoPlan, F1_RECORDING_ASSETS } from './f1-recording-demo';
import { generateComposition } from './composition';
import { visibleMotion } from './clip-effects';

test('F1 cut preview starts with full source, then preserves the same retained video/audio through all text and effect stages', () => {
  const plan = f1RecordingDemoPlan('take');
  expect(Math.max(...plan.initial.clips.map(clip => clip.start + clip.duration))).toBe(89);
  expect(plan.initial.clips.filter(clip => clip.kind === 'video').map(clip => [clip.sourceStart, clip.duration])).toEqual([[0, 6], [6, 7], [13, 76]]);
  expect(plan.cutPreview).toMatchObject({ start: 6, end: 13, removedClipIds: ['take-section-1', 'take-section-1-audio'], movingClipIds: ['take-section-2', 'take-section-2-audio'] });
  expect(() => generateComposition(plan.initial, plan.assets)).not.toThrow();
  let current = plan.cutPreview.timeline;
  for (const step of plan.steps) {
    current = { ...current, clips: [...current.clips, ...step.clips] };
    expect(() => generateComposition(current, plan.assets)).not.toThrow();
    if (step.previewTime !== undefined) {
      expect(step.previewTime).toBeGreaterThanOrEqual(0);
      expect(step.previewTime).toBeLessThan(Math.max(...current.clips.map(clip => clip.start + clip.duration)));
    }
  }
  expect(current.clips).toEqual(plan.timeline.clips);
  const video = current.clips.filter(clip => clip.kind === 'video');
  expect(video).toHaveLength(11);
  let end = 0;
  for (const shot of video) {
    expect(shot.start).toBe(end);
    expect(shot.sourceStart).toBe(shot.start < 6 ? shot.start : shot.start + 7);
    expect(shot.assetId).toBe('f1-recording-video');
    expect(current.clips.find(clip => clip.id === shot.linkedClipId)).toMatchObject({
      kind: 'audio', assetId: 'f1-recording-audio', sourceStart: shot.sourceStart, start: shot.start, duration: shot.duration, linkedClipId: shot.id, volume: 1,
    });
    end += shot.duration;
  }
  expect(end).toBe(82);
  const titles = current.clips.filter(clip => clip.kind === 'graphic');
  expect(titles).toHaveLength(5);
  expect(titles.every(clip => clip.track === 2 && clip.textTemplate && clip.start + clip.duration <= 82)).toBe(true);
  expect(titles.map(clip => clip.start)).toEqual([0, 14.2, 37.3, 61.25, 75.3]);
  const effects = current.clips.filter(clip => clip.kind === 'effect');
  expect(effects).toHaveLength(8);
  expect(effects.filter(clip => clip.effectPreset === 'punch')).toHaveLength(4);
  expect(effects.filter(clip => clip.effectPreset === 'flash')).toHaveLength(4);
  expect(effects.every(clip => clip.track === 1 && visibleMotion(clip).some(key => key.scale > 1 || key.brightness > 1))).toBe(true);
  expect(plan.assets).toEqual(F1_RECORDING_ASSETS);
});

test('narrated F1 phases correspond to footage, text and effect insertions with unique replay IDs', () => {
  const plan = f1RecordingDemoPlan('first'), replay = f1RecordingDemoPlan('second');
  const phases = plan.steps.filter(step => step.narrate);
  expect(phases).toHaveLength(3);
  expect(phases.map(step => step.clips[0]?.kind ?? 'arranging')).toEqual(['arranging', 'graphic', 'effect']);
  expect(phases[1].reply).toContain('title');
  expect(phases[2].reply).toContain('effects track');
  expect(new Set(plan.timeline.clips.map(clip => clip.id)).size).toBe(plan.timeline.clips.length);
  expect(plan.timeline.clips.some(clip => replay.timeline.clips.some(other => other.id === clip.id))).toBe(false);
});
