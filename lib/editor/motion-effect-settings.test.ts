import { expect, test } from 'vitest';
import { configureTimedEffectPatch, motionAt, validateClipEffects } from './clip-effects';
import { flashKeyframes, flashSettings, punchKeyframes, punchDurations, popKeyframes, shakeKeyframes } from './motion-effect-settings';
import { addEffectClip, patchClip, splitClip } from './operations';
import type { Clip, Timeline } from './types';

const effect: Clip = { id: 'fx', kind: 'effect', effectPreset: 'flash', track: 1, start: 2, duration: 1, sourceStart: 0 };
test('Flash strength and attack/release shape a bounded pulse with a neutral remainder', () => {
  const patch = configureTimedEffectPatch(effect, { flash: { strength: .25, attack: .2, release: .3 } });
  expect(motionAt(patch.motion!, .2).brightness).toBeCloseTo(1.75);
  expect(motionAt(patch.motion!, .5).brightness).toBe(1);
  expect(motionAt(patch.motion!, 1).brightness).toBe(1);
  expect(() => configureTimedEffectPatch(effect, { flash: { attack: .8, release: .3 } })).toThrow('fit');
  expect(() => configureTimedEffectPatch(effect, { flash: { strength: 1.1 } })).toThrow('strength');
  const legacy = { ...effect, motion: flashKeyframes(1, { strength: .2, attack: .3, release: .5 }) };
  expect(flashSettings(legacy)).toEqual({ strength: expect.closeTo(.2), attack: .3, release: .5 });
});
test('Punch amount/center/speed and Pop starting size/bounce/speed change the actual sampled motion', () => {
  const punch = punchKeyframes(1, { amount: 1.6, speed: 2, centerX: .8, centerY: .2 });
  expect(punch[1]).toMatchObject({ scale: 1.6, x: expect.closeTo(-.18), y: expect.closeTo(.18) });
  expect(punch[2].time).toBeCloseTo(.175);
  expect(motionAt(punch, .175).scale).toBe(1);
  const pop = popKeyframes(1, { startScale: .4, bounce: .2, speed: 2 });
  expect(pop[0]).toMatchObject({ scale: .4, opacity: 0 });expect(pop[1].scale).toBe(1.2);expect(pop[2].time).toBeCloseTo(.175);
});
test('Punch optional attack/return edit actual peak and recovery while legacy timings and split phase remain intact', () => {
  const old = { amount: 1.6, speed: 2, centerX: .8, centerY: .2 };
  const legacy = punchKeyframes(1, old);
  expect(legacy.map(frame => frame.time)).toEqual([0, .175 * .3, .175, 1]);
  const explicit = { ...old, speed: 1, attack: .2, release: .3 };
  const motion = punchKeyframes(1, explicit);
  expect(motionAt(motion, .2).scale).toBe(1.6); expect(motionAt(motion, .5).scale).toBe(1);
  expect(punchDurations(.25, explicit)).toEqual({ attack: .1, release: .15, end: .25 });
  expect(punchDurations(1, { ...explicit, speed: 2 })).toEqual({ attack: .1, release: .15, end: .25 });
  const added = addEffectClip({ fps: 30, aspectRatio: 'landscape', clips: [] }, 'punch', 'punch', 0, { duration: 1 });
  const configured = patchClip(added, 'punch', configureTimedEffectPatch(added.clips[0], { punch: explicit }));
  const split = splitClip(configured, 'punch', .3, 'tail');
  expect(split.clips[1].punch).toEqual(explicit); expect(split.clips[1].motion).toEqual(motion); expect(split.clips[1].motionOffset).toBe(.3);
  for (const value of [0, 30.01, NaN, Infinity]) expect(() => validateClipEffects({ ...configured.clips[0], punch: { ...explicit, attack: value } })).toThrow('attack');
});
test('Shake isolates the chosen axis, bypasses at zero strength and stays inside the save keyframe limit', () => {
  for (const direction of ['horizontal', 'vertical', 'both'] as const) {
    const motion = shakeKeyframes(60, { strength: 1, speed: 4, direction });
    expect(motion.length).toBeLessThanOrEqual(120);
    expect(() => validateClipEffects({ ...effect, effectPreset: 'shake', duration: 60, motion })).not.toThrow();
    if (direction !== 'both') expect(motion.every(key => key[direction === 'horizontal' ? 'y' : 'x'] === 0 && key.rotation === 0)).toBe(true);
    expect(motion[0]).toMatchObject({ x: 0, y: 0, scale: 1 });expect(motion.at(-1)).toMatchObject({ x: 0, y: 0, scale: 1 });
  }
  expect(shakeKeyframes(1, { strength: 0, speed: 2, direction: 'both' }).every(key => key.x === 0 && key.y === 0 && key.rotation === 0 && key.scale === 1)).toBe(true);
});
test('settings preserve unrelated clips, survive splits with phase and regenerate explicitly resized pulses', () => {
  const base: Timeline = { fps: 30, aspectRatio: 'landscape', clips: [] };
  const added = addEffectClip(base, 'fx', 'flash', 2, { duration: 1 });
  const configured = patchClip(added, 'fx', configureTimedEffectPatch(added.clips[0], { flash: { strength: .3, attack: .2, release: .6 } }));
  const split = splitClip(configured, 'fx', 2.4, 'tail');
  expect(split.clips[1]).toMatchObject({ flash: configured.clips[0].flash, motionOffset: .4 });
  expect(split.clips[1].motion).toEqual(configured.clips[0].motion);
  const resized = configureTimedEffectPatch(configured.clips[0], { duration: 2 });
  expect({ ...configured.clips[0], ...resized }.flash).toEqual(configured.clips[0].flash);
  expect(motionAt(resized.motion!, .4).brightness).toBeCloseTo(1.9);
  expect(() => configureTimedEffectPatch(effect, { shake: { strength: .2 } })).toThrow('belong');
  expect(() => configureTimedEffectPatch(effect, { flash: {} })).toThrow('Specify');
});
