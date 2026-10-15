import { expect, test } from 'vitest';
import { TEXT_LOOKS, selectedTextLook, textLookPatch } from './text-looks';
import { TEXT_ANIMATION_PRESETS, textAnimationPatch } from './text-effects';
import { DEFAULT_TEXT_APPEARANCE } from './text-style';
import type { Clip } from './types';

const text: Clip = { id: 'words', kind: 'caption', text: 'My exact words', start: 5, duration: 3, sourceStart: 0, fontFamily: 'dm-serif', fontSize: 83, color: '#12ab67', background: '#17234f', blendMode: 'screen', x: .3, y: .7, transform: { x: 0, y: 0, scale: 1, rotation: 12, opacity: 1 }, textStyle: { ...DEFAULT_TEXT_APPEARANCE, strokeWidth: 3, glowBlur: 21, glowColor: '#ff3366' } };

test.each(TEXT_ANIMATION_PRESETS)('%s changes animation without overwriting words or any appearance', preset => {
  const next = { ...text, ...textAnimationPatch(text, preset) };
  for (const key of ['text','fontFamily','fontSize','color','background','blendMode','x','y','transform','textStyle','start','duration','sourceStart'] as const) expect(next[key]).toEqual(text[key]);
  expect(next.textAnimationTiming).toBeUndefined();
});

test('looks are editable combinations and ordinary looks preserve independent animation', () => {
  const animated = { ...text, ...textAnimationPatch(text, 'word-reveal') };
  const boxed = { ...animated, ...textLookPatch(animated, 'boxed') };
  expect(boxed.textTemplate).toEqual(animated.textTemplate);
  expect(boxed.text).toBe(text.text); expect(boxed.start).toBe(text.start); expect(boxed.duration).toBe(text.duration);
  expect(boxed.background).toBe('#0B0C0EE6');
  for (const look of TEXT_LOOKS) {
    const next = { ...text, ...textLookPatch(text, look.id) };
    expect(next.textStyle).toEqual(look.style);
    expect({ ...next, ...textAnimationPatch(next, 'rise') }.textStyle).toEqual(look.style);
  }
});

test('Default and Neon Echo styles change appearance without adding or clearing animation', () => {
  const neon = { ...text, ...textLookPatch(text, 'neon-echo') };
  expect(neon.textTemplate).toBeUndefined();
  expect(neon.animation).toBeUndefined();
  const plain = { ...neon, ...textLookPatch(neon, 'default') };
  expect(plain.textTemplate).toBeUndefined(); expect(plain.motion).toBeUndefined(); expect(plain.animation).toBeUndefined();
  expect(plain.textStyle).toEqual(DEFAULT_TEXT_APPEARANCE); expect(plain.text).toBe(text.text);
});

const animationCases: { name: string; animation: Partial<Clip> }[] = [
  ...(['fade', 'rise', 'pop'] as const).map(preset => ({ name: preset, animation: textAnimationPatch(text, preset) })),
  { name: 'split basic timing', animation: { animation: 'fade', textAnimationTiming: { duration: 5, offset: 1.6 } } },
  { name: 'word-timed Remotion controls', animation: { animation: 'none', textTemplate: { preset: 'karaoke', duration: 8, offset: 2.4, highlightColor: '#12AB67', strength: .7, revealDuration: .65, stagger: .09, wordTimings: [{ start: 0, end: .3 }, { start: .3, end: .8 }, { start: .8, end: 1.2 }] } } },
  { name: 'custom motion and phase', animation: { animation: 'none', motion: [{ time: 0, x: 0, y: .2, scale: .8, rotation: -8, opacity: 0, brightness: 1 }, { time: 2, x: .1, y: 0, scale: 1.1, rotation: 4, opacity: 1, brightness: 1 }], motionOffset: 1.2 } },
];
test.each(animationCases)('applying any ready style preserves $name exactly', ({ animation }) => {
  const animated = { ...text, ...animation };
  for (const look of TEXT_LOOKS) {
    const patch = textLookPatch(animated, look.id);
    for (const key of ['animation', 'textTemplate', 'textAnimationTiming', 'motion', 'motionOffset'] as const) {
      expect(patch).not.toHaveProperty(key);
      expect({ ...animated, ...patch }[key]).toEqual(animated[key]);
    }
    const next = { ...animated, ...patch };
    expect(next.textStyle).toEqual(look.style);
    expect(selectedTextLook(next)).toBe(look.id);
    for (const key of ['text', 'fontFamily', 'x', 'y', 'transform', 'start', 'duration', 'sourceStart'] as const) expect(next[key]).toEqual(animated[key]);
  }
});

test('animation selection materializes plain appearance and keeps legacy Neon styling editable', () => {
  const plain = { ...text, kind: 'graphic' as const, textStyle: undefined, textTemplate: undefined };
  expect(textAnimationPatch(plain, 'neon-echo').textStyle).toEqual(DEFAULT_TEXT_APPEARANCE);
  const legacy = { ...plain, textTemplate: { preset: 'neon-echo' as const } };
  const patch = textAnimationPatch(legacy, 'word-reveal');
  expect(patch.textStyle?.strokeWidth).toBeCloseTo(83 * .048); expect(patch.color).toBeUndefined();
  expect(patch.textTemplate?.highlightColor).toBe('#FF962E');
  expect(textAnimationPatch({ ...plain, textTemplate: { preset: 'kinetic-stack' } }, 'karaoke').textTemplate?.highlightColor).toBe('#BA83FF');
});
