import { expect, test } from 'vitest';
import { COLOR_LOOKS, colorLookGrade, selectedColorLook } from './color-looks';
import { DEFAULT_COLOR_GRADE, validateVisualEffects } from './visual-effects';

test('saved graded controls recover the selected look and strength without extra clip fields', () => {
  for (const look of COLOR_LOOKS) for (const strength of [.01, .45, 1]) {
    const grade = JSON.parse(JSON.stringify(colorLookGrade(look.id, strength)));
    expect(() => validateVisualEffects({ kind: 'video', colorGrade: grade })).not.toThrow();
    expect(selectedColorLook(grade)?.id).toBe(look.id);
    expect(selectedColorLook(grade)?.strength).toBeCloseTo(strength);
    expect(selectedColorLook({ ...grade, enabled: false })?.id).toBe(look.id);
  }
});

test('zero strength is neutral and manually adjusted colors stop claiming a preset match', () => {
  expect(colorLookGrade('warm-film', 0)).toEqual({ ...DEFAULT_COLOR_GRADE, enabled: true });
  expect(selectedColorLook(colorLookGrade('warm-film', 0))).toBeUndefined();
  expect(selectedColorLook({ ...colorLookGrade('cool-cinema'), tint: 20 })).toBeUndefined();
  expect(colorLookGrade('noir').saturation).toBe(0);
});
