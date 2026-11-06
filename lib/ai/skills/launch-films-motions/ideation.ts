import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

export const ideationPage: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/ideation.md").name,
  description: skillDocument("launch-films-motions/references/ideation.md").description,
  body: skillText("launch-films-motions/references/ideation.md"),
};
