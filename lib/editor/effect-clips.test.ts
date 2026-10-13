import { expect, test } from 'vitest';
import { EFFECT_PRESETS, motionAt, visibleMotion } from './clip-effects';
import { addEffectClip, splitClip } from './operations';
import { resizeSelectedClips, moveSelectedClips } from './timeline-controls';
import { clipColor, type Timeline } from './types';
import { generateComposition } from './composition';

const timeline: Timeline = { fps: 30, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 0 }, clips: [{ id: 'footage', kind: 'graphic', text: 'Footage placeholder', start: 0, duration: 20, sourceStart: 0, track: 1 }] };

test.each(EFFECT_PRESETS)('%s is an independent effect at the playhead on a higher V track', preset => {
  const next = addEffectClip(timeline, 'effect', preset, 10, { aboveClipId: 'footage' });
  expect(next.clips[0]).toEqual(timeline.clips[0]);
  expect(next.clips[1]).toMatchObject({ kind: 'effect', start: 10, track: 2, effectPreset: preset, sourceStart: 0 });
  expect(next.clips[1].motion?.length).toBeGreaterThan(1);
  expect(clipColor('effect')).not.toBe(clipColor('video'));
  const moved = moveSelectedClips(next, ['effect'], 2, 0);
  expect(moved.clips[1].start).toBe(12);
  expect(moved.clips[0]).toEqual(timeline.clips[0]);
});

test('effect resizing stretches the pulse, while split pieces retain their original phase', () => {
  const next = addEffectClip(timeline, 'effect', 'cinematic-bars', 10, { duration: 2 });
  const effect = next.clips[1];
  const resized = resizeSelectedClips(next, [], ['effect'], 'right', 2).clips[1];
  expect(resized.duration).toBe(4);
  expect(resized.motion?.at(-1)?.time).toBe(4);
  expect(motionAt(resized.motion!, .4).opacity).toBeCloseTo(motionAt(effect.motion!, .2).opacity);
  const left = resizeSelectedClips(next, [], ['effect'], 'left', -.5).clips[1];
  expect(left).toMatchObject({ start: 9.5, duration: 2.5, sourceStart: 0 });
  const split = splitClip(next, 'effect', 11, 'tail');
  const tail = split.clips.find(clip => clip.id === 'tail')!;
  expect(tail).toMatchObject({ sourceStart: 0, motionOffset: 1 });
  expect(visibleMotion(tail)[0].opacity).toBe(1);
  expect(visibleMotion(tail).at(-1)?.opacity).toBe(0);
});

test('effect wrappers never become timed roots that hide underlying footage', () => {
  const next = addEffectClip(timeline, 'effect', 'flash', 10, { duration: 1 });
  const html = generateComposition(next, []);
  expect(html).toContain('data-effect-clip="effect" class="adjustment-layer"');
  expect(html).not.toContain('id="clip-1" data-start=');
  expect(html).toContain("timeline.set('#clip-1-motion',");
  expect(html).toContain('"filter":"brightness(1)"},11)');
});
