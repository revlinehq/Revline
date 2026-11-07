import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

export const music: EditorSkill = {
  name: skillDocument("music/SKILL.md").name,
  description: skillDocument("music/SKILL.md").description,
  body: skillText("music/SKILL.md"),
};
