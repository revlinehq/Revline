import { expect, test } from 'vitest';
import { configureTimedEffectPatch, validateClipEffects, visibleMotion, zoomSettings } from './clip-effects';
import { addEffectClip, patchClip, splitClip } from './operations';
import { EMPTY_TIMELINE, type Clip } from './types';

test('one Zoom recipe supports both directions, target strength, speed and center without touching media', () => {
  const base = addEffectClip(EMPTY_TIMELINE, 'zoom', 'quick-zoom-in', 2, { duration: 2 });
  const before = base.clips[0];
  expect(zoomSettings(before)).toEqual({ direction: 'in', amount: 1.2, speed: 1, centerX: .5, centerY: .5 });
  const next = patchClip(base, 'zoom', configureTimedEffectPatch(before, { zoom: { direction: 'out', amount: 2, speed: 2, centerX: .75 } }));
  const clip = next.clips[0], motion = visibleMotion(clip);
  expect(clip).toMatchObject({ id: 'zoom', start: 2, duration: 2, sourceStart: 0, effectPreset: 'quick-zoom-out', zoom: { direction: 'out', amount: 2, speed: 2, centerX: .75, centerY: .5 } });
  expect(motion[0]).toMatchObject({ scale: 2, x: -.25 });
  expect(motion.find(frame => frame.time === 1)?.scale).toBe(1);expect(motion.find(frame => frame.time === 1)?.x).toBeCloseTo(0);
  expect(motion.at(-1)?.scale).toBe(1);
  const slow = configureTimedEffectPatch(clip, { zoom: { direction: 'in', speed: .5 } });
  expect(slow.motion?.at(-1)?.scale).toBe(1.5);
  expect(slow.zoom?.centerX).toBe(.75);
  expect(configureTimedEffectPatch({ ...clip, ...slow }, { duration: 4 }).motion?.at(-1)?.time).toBe(4);
});

test('legacy zoom clips retain original keyframes until an explicit control change', () => {
  const legacy: Clip = { id: 'old', kind: 'effect', effectPreset: 'quick-zoom-out', start: 0, duration: 1, sourceStart: 0, motion: [{ time: 0, x: 0, y: 0, scale: 1.4, rotation: 0, opacity: 1, brightness: 1 }, { time: 1, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, brightness: 1 }] };
  const saved = JSON.stringify(legacy);
  expect(zoomSettings(legacy)).toMatchObject({ direction: 'out', amount: 1.4 });
  expect(JSON.stringify(legacy)).toBe(saved);
  const changed = configureTimedEffectPatch(legacy, { zoom: { centerY: .2 } });
  expect(changed.zoom).toMatchObject({ direction: 'out', amount: 1.4, centerY: .2 });
  expect(JSON.stringify(legacy)).toBe(saved);
  const split = splitClip({ ...EMPTY_TIMELINE, clips: [{ ...legacy, ...changed }] }, 'old', .5, 'right');
  expect(split.clips.every(clip => clip.zoom?.amount === 1.4)).toBe(true);
});

test('zoom controls reject unrelated clips and invalid values', () => {
  const clip = addEffectClip(EMPTY_TIMELINE, 'zoom', 'quick-zoom-in', 0).clips[0];
  for (const changes of [{ amount: 4 }, { speed: 0 }, { centerX: -1 }, { centerY: Number.NaN }]) expect(() => configureTimedEffectPatch(clip, { zoom: changes })).toThrow('Zoom');
  expect(() => configureTimedEffectPatch(clip, { zoom: {} })).toThrow('Specify');
  expect(() => configureTimedEffectPatch({ ...clip, effectPreset: 'flash', zoom: undefined }, { zoom: { amount: 2 } })).toThrow('Zoom');
  expect(() => validateClipEffects({ ...clip, zoom: { ...zoomSettings(clip), direction: 'out' } })).toThrow('matching');
});
