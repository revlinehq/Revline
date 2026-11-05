import { skillText, skillDocument } from './documents';
import { HSL_BANDS, LUT_LOOKS } from '../../editor/color-finish';
import type { EditorSkill } from './index';

export const colorGrading: EditorSkill = {
  name: skillDocument("color-grading/SKILL.md").name,
  description: skillDocument("color-grading/SKILL.md").description,
  body: skillText("color-grading/SKILL.md", [HSL_BANDS.join(', '), LUT_LOOKS.join(', ')]),
};
