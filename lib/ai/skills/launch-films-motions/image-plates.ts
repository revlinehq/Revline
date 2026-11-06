import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

export const imagePlatesPage: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/image-plates.md").name,
  description: skillDocument("launch-films-motions/references/image-plates.md").description,
  body: skillText("launch-films-motions/references/image-plates.md"),
};
