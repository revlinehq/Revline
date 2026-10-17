import { expect, test } from 'vitest';
import { generateComposition } from './composition';
import { playbackRateOf, sourceEndOf } from './playback-rate';
import { RACING_DEMO_ASSETS, racingDemoPlan } from './racing-demo';
import { timelineDuration } from './types';

const shotFrames = [60, 72, 54, 72, 48, 90];

test('the racing take builds six contiguous cuts with their native linked sound', () => {
  const originalAssets = structuredClone(RACING_DEMO_ASSETS);
  const plan = racingDemoPlan('race');
  expect(plan.initial).toMatchObject({ fps: 30, aspectRatio: 'landscape', tracks: { visual: 2, overlay: 0, audio: 1, effects: 1 }, clips: [] });
  let clips = plan.initial.clips;
  for (const step of plan.steps) {
    clips = [...clips, ...step.clips];
    expect(() => generateComposition({ ...plan.initial, clips }, plan.assets)).not.toThrow();
    for (const shot of step.clips.filter(clip => clip.kind === 'video')) {
      expect(step.clips.find(clip => clip.id === shot.linkedClipId)).toMatchObject({ kind: 'audio', linkedClipId: shot.id });
    }
  }
  expect(clips).toEqual(plan.timeline.clips);
  expect(timelineDuration(plan.timeline)).toBeCloseTo(396 / 30, 10);
  const shots = clips.filter(clip => clip.kind === 'video').sort((a, b) => a.start - b.start);
  const audio = clips.filter(clip => clip.kind === 'audio');
  expect(shots).toHaveLength(6);
  expect(audio).toHaveLength(6);
  expect(new Set(shots.map(shot => shot.assetId)).size).toBe(6);
  expect(plan.steps.filter(step => step.clips.some(clip => clip.kind === 'video'))).toHaveLength(6);
  let frame = 0;
  for (const [index, shot] of shots.entries()) {
    const source = plan.assets.find(asset => asset._id === shot.assetId)!;
    const sound = audio.find(clip => clip.id === shot.linkedClipId)!;
    const soundSource = plan.assets.find(asset => asset._id === sound.assetId)!;
    expect(shot).toMatchObject({ track: 1, sourceStart: 0, volume: 0, audioSeparated: true });
    expect(shot.start).toBeCloseTo(frame / 30, 10);
    expect(shot.duration).toBeCloseTo(shotFrames[index] / 30, 10);
    expect(playbackRateOf(shot)).toBe(1);
    expect(source).toMatchObject({ kind: 'video', width: 1280, height: 720, audioAssetId: sound.assetId });
    expect(source.duration).toBeCloseTo(shot.duration, 10);
    expect(sourceEndOf(shot)).toBeLessThanOrEqual(source.duration! + 1e-6);
    expect(sound).toMatchObject({ kind: 'audio', track: 1, start: shot.start, duration: shot.duration, sourceStart: 0, linkedClipId: shot.id });
    expect(playbackRateOf(sound)).toBe(1);
    expect(sound.volume ?? 1).toBeGreaterThan(0);
    expect(soundSource.kind).toBe('audio');
    expect(soundSource.url).toMatch(/\.(?:m4a|aac)$/);
    expect(soundSource.url).not.toBe(source.url);
    expect(sourceEndOf(sound)).toBeLessThanOrEqual(soundSource.duration! + 1e-6);
    expect(source.waveform).toEqual(soundSource.waveform);
    expect(source.waveform?.samplesPerSecond).toBeGreaterThan(0);
    expect(Buffer.from(source.waveform!.peaks, 'base64').some(peak => peak > 0)).toBe(true);
    frame += shotFrames[index];
  }
  expect(RACING_DEMO_ASSETS).toEqual(originalAssets);
  const other = racingDemoPlan('another-race');
  expect(new Set(clips.map(clip => clip.id)).size).toBe(clips.length);
  expect(clips.some(clip => other.timeline.clips.some(otherClip => otherClip.id === clip.id))).toBe(false);
});

test('the racing titles use the three fixed title cues without speech captions', () => {
  const clips = racingDemoPlan('race').timeline.clips;
  const titles = clips.filter(clip => clip.kind === 'graphic').sort((a, b) => a.start - b.start);
  expect(titles.map(title => title.text)).toEqual(['RACE DAY', 'EVERY SECOND', 'COUNTS']);
  for (const [index, title] of titles.entries()) {
    expect(title.start).toBeCloseTo([0, 4.4, 10.2][index], 10);
    expect(title.duration).toBeCloseTo([2, 1.8, 3][index], 10);
    expect(title).toMatchObject({ track: 2, sourceStart: 0, fontFamily: 'anton', animation: 'none', textTemplate: { preset: 'slide-title' } });
    expect(title.fontSize).toBeGreaterThanOrEqual(100);
    expect(title.fontSize).toBeLessThanOrEqual(180);
    expect(title.start + title.duration).toBeLessThanOrEqual(13.2 + 1e-6);
  }
  expect(clips.some(clip => clip.kind === 'caption')).toBe(false);
});

test('only the two pit shots receive subtle anchored zooms that return to neutral', () => {
  const clips = racingDemoPlan('race').timeline.clips;
  const shots = clips.filter(clip => clip.kind === 'video').sort((a, b) => a.start - b.start);
  const effects = clips.filter(clip => clip.kind === 'effect').sort((a, b) => a.start - b.start);
  expect(effects).toHaveLength(2);
  for (const [index, effect] of effects.entries()) {
    const shot = shots[[2, 4][index]];
    expect(effect).toMatchObject({ track: 1, effectPreset: 'quick-zoom-in', sourceStart: 0 });
    expect(effect.start).toBeCloseTo([4.4, 8.6][index], 10);
    expect(effect.duration).toBeCloseTo([1.8, 1.6][index], 10);
    expect(effect.start).toBeCloseTo(shot.start, 10);
    expect(effect.start + effect.duration).toBeCloseTo(shot.start + shot.duration, 10);
    const motion = effect.motion!;
    expect(motion.length).toBeGreaterThan(3);
    expect(motion[0]).toMatchObject({ time: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 });
    expect(motion.at(-1)).toMatchObject({ scale: 1, rotation: 0, opacity: 1, brightness: 1 });
    for (const edge of [motion[0], motion.at(-1)!]) {
      expect(edge.x).toBeCloseTo(0, 10);
      expect(edge.y).toBeCloseTo(0, 10);
    }
    expect(motion.at(-1)?.time).toBeCloseTo(effect.duration, 10);
    const peak = motion.reduce((a, b) => a.scale > b.scale ? a : b);
    expect(peak.scale).toBeCloseTo([1.04, 1.05][index], 10);
    const centerX = .5 - peak.x / (peak.scale - 1), centerY = .5 - peak.y / (peak.scale - 1);
    expect(centerX).toBeGreaterThanOrEqual(0);
    expect(centerX).toBeLessThanOrEqual(1);
    expect(centerY).toBeGreaterThanOrEqual(0);
    expect(centerY).toBeLessThanOrEqual(1);
    for (const [keyIndex, key] of motion.entries()) {
      expect(key).toMatchObject({ rotation: 0, opacity: 1, brightness: 1 });
      expect(key.scale).toBeGreaterThanOrEqual(1);
      expect(key.scale).toBeLessThanOrEqual(peak.scale);
      expect(key.x).toBeCloseTo((.5 - centerX) * (key.scale - 1), 10);
      expect(key.y).toBeCloseTo((.5 - centerY) * (key.scale - 1), 10);
      if (keyIndex) expect(key.time).toBeGreaterThan(motion[keyIndex - 1].time);
    }
  }
  expect(clips.some(clip => clip.effectPreset === 'flash' || clip.transition)).toBe(false);
});
