import { DEFAULT_COLOR_GRADE, type ColorGrade } from './visual-effects';

const fields = ['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'vibrance'] as const;

/** Recipes use the existing grading pass, shared by live preview and export. */
export const COLOR_LOOKS = [
  { id: 'warm-film', label: 'Warm Film', colors: ['#463b32', '#a77656', '#e4ca9a'], grade: { exposure: .08, contrast: 1.12, saturation: .86, temperature: 26, tint: 3, vibrance: 8 } },
  { id: 'cool-cinema', label: 'Cool Cinema', colors: ['#263b48', '#69858d', '#c7cdd0'], grade: { exposure: -.06, contrast: 1.18, saturation: .82, temperature: -25, tint: -5, vibrance: 4 } },
  { id: 'golden-hour', label: 'Golden Hour', colors: ['#674630', '#ca9357', '#f1d19b'], grade: { exposure: .16, contrast: 1.06, saturation: .96, temperature: 43, tint: 6, vibrance: 14 } },
  { id: 'muted-film', label: 'Muted Film', colors: ['#454944', '#93917d', '#c8bca6'], grade: { exposure: .08, contrast: .88, saturation: .7, temperature: 12, tint: -4, vibrance: -8 } },
  { id: 'noir', label: 'Noir', colors: ['#171717', '#747474', '#dcdcdc'], grade: { exposure: -.04, contrast: 1.24, saturation: 0, temperature: 0, tint: 0, vibrance: 0 } },
] as const;
export type ColorLookId = typeof COLOR_LOOKS[number]['id'];

export function colorLookGrade(id: ColorLookId, strength = 1): ColorGrade {
  const look = COLOR_LOOKS.find(item => item.id === id)!;
  const amount = Math.max(0, Math.min(1, strength));
  return { enabled: true, ...Object.fromEntries(fields.map(key => [key, DEFAULT_COLOR_GRADE[key] + (look.grade[key] - DEFAULT_COLOR_GRADE[key]) * amount])) } as ColorGrade;
}

/** Recover selection/strength from saved controls, without extra timeline fields. */
export function selectedColorLook(grade?: ColorGrade): { id: ColorLookId; strength: number } | undefined {
  if (!grade) return;
  for (const look of COLOR_LOOKS) {
    const strength = (grade.contrast - 1) / (look.grade.contrast - 1);
    if (strength <= 1e-6 || strength > 1 + 1e-6) continue;
    const expected = colorLookGrade(look.id, strength);
    if (fields.every(key => Math.abs(grade[key] - expected[key]) < 1e-6)) return { id: look.id, strength: Math.min(1, strength) };
  }
}

export function isNeutralColorGrade(grade: ColorGrade) {
  return fields.every(key => Math.abs(grade[key] - DEFAULT_COLOR_GRADE[key]) < 1e-6);
}
