import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

export const genesis: EditorSkill = {
  name: skillDocument("genesis/SKILL.md").name,
  description: skillDocument("genesis/SKILL.md").description,
  body: skillText("genesis/SKILL.md"),
};
