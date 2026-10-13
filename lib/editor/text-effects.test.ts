import { expect, test } from 'vitest';
import { selectedTextEffect, textEffectPatch, textTemplatePatch, TEXT_EFFECT_PRESETS } from './text-effects';
import { validateClipEffects } from './clip-effects';
import type { Clip } from './types';

const text: Clip = { id: 'title', kind: 'graphic', text: 'Hello', start: 3, duration: 2, sourceStart: 0, track: 2 };

test('text template and entrance remain selected in either application order', () => {
  for (const preset of ['pop', 'fade', 'rise', 'none'] as const) {
    let clip = { ...text, ...textTemplatePatch(text, 'neon-echo') };
    clip = { ...clip, ...textEffectPatch(clip, preset) };
    expect(clip.textTemplate?.preset).toBe('neon-echo');
    expect(selectedTextEffect(clip)).toBe(preset);
    clip = { ...clip, ...textTemplatePatch(clip, 'word-reveal') };
    expect(selectedTextEffect(clip)).toBe(preset);
    expect(clip.textTemplate?.preset).toBe('word-reveal');
  }
});

test('switching text animations replaces prior motion and keeps the text clip timing', () => {
  let clip = text;
  for (const preset of ['pop', 'fade', 'rise', 'none'] as const) {
    clip = { ...clip, ...textEffectPatch(clip, preset) };
    expect(selectedTextEffect(clip)).toBe(preset);
    expect(() => validateClipEffects(clip)).not.toThrow();
    expect(clip).toMatchObject({ id: 'title', kind: 'graphic', start: 3, duration: 2, track: 2, text: 'Hello' });
    if (preset !== 'pop') expect(clip.motion).toEqual([]);
  }
});

test('text presets refuse footage, audio and saved adjustment clips', () => {
  for (const kind of ['video', 'image', 'audio', 'effect'] as const) {
    for (const preset of TEXT_EFFECT_PRESETS) expect(() => textEffectPatch({ ...text, kind }, preset)).toThrow('Select a text clip');
  }
});
