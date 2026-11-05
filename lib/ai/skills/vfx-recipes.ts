import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './index';

export const vfxRecipes: EditorSkill = {
  name: skillDocument("vfx-recipes/SKILL.md").name,
  description: skillDocument("vfx-recipes/SKILL.md").description,
  get body() {
    return skillText("vfx-recipes/SKILL.md");
  },
};
