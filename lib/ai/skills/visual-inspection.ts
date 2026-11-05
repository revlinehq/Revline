import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

export const visualInspection: EditorSkill = {
  name: skillDocument("visual-inspection/SKILL.md").name,
  description: skillDocument("visual-inspection/SKILL.md").description,
  body: skillText("visual-inspection/SKILL.md"),
};
