import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

export const transitions: EditorSkill = {
  name: skillDocument("transitions/SKILL.md").name,
  description: skillDocument("transitions/SKILL.md").description,
  body: skillText("transitions/SKILL.md"),
};
