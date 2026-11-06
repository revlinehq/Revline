import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

export const backgroundsPage: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/backgrounds.md").name,
  description: skillDocument("launch-films-motions/references/backgrounds.md").description,
  body: skillText("launch-films-motions/references/backgrounds.md"),
};
