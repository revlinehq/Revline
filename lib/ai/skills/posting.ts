import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

export const posting: EditorSkill = {
  name: skillDocument("posting/SKILL.md").name,
  description: skillDocument("posting/SKILL.md").description,
  body: skillText("posting/SKILL.md"),
};
