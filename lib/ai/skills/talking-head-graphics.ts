import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

export const talkingHeadGraphics: EditorSkill = {
  name: skillDocument("talking-head-graphics/SKILL.md").name,
  description: skillDocument("talking-head-graphics/SKILL.md").description,
  body: skillText("talking-head-graphics/SKILL.md"),
};
