import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

export const shotChangesPage: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/shot-changes.md").name,
  description: skillDocument("launch-films-motions/references/shot-changes.md").description,
  body: skillText("launch-films-motions/references/shot-changes.md"),
};
