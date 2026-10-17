import { expect, test } from 'vitest';
import { f1RecordingDemoPlan, F1_RECORDING_ASSETS } from './f1-recording-demo';
import { generateComposition } from './composition';
import { visibleMotion } from './clip-effects';

test('F1 stages add real animated text and timed effects while keeping all original footage and sound', () => {
  const plan = f1RecordingDemoPlan('take');
  let current = plan.initial;
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
  expect(video).toHaveLength(12);
  let end = 0;
  for (const shot of video) {
    expect(shot.start).toBe(end);
    expect(shot.sourceStart).toBe(shot.start);
    expect(shot.assetId).toBe('f1-recording-video');
    expect(current.clips.find(clip => clip.id === shot.linkedClipId)).toMatchObject({
      kind: 'audio', assetId: 'f1-recording-audio', sourceStart: shot.sourceStart, start: shot.start, duration: shot.duration, linkedClipId: shot.id, volume: 1,
    });
    end += shot.duration;
  }
  expect(end).toBe(89);
  const titles = current.clips.filter(clip => clip.kind === 'graphic');
  expect(titles).toHaveLength(5);
  expect(titles.every(clip => clip.track === 2 && clip.textTemplate && clip.start + clip.duration <= 89)).toBe(true);
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
  expect(phases.map(step => step.clips[0].kind)).toEqual(['video', 'graphic', 'effect']);
  expect(phases[1].reply).toContain('title');
  expect(phases[2].reply).toContain('effects track');
  expect(new Set(plan.timeline.clips.map(clip => clip.id)).size).toBe(plan.timeline.clips.length);
  expect(plan.timeline.clips.some(clip => replay.timeline.clips.some(other => other.id === clip.id))).toBe(false);
});
