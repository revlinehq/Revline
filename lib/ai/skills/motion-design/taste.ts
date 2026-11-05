import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

export const tastePage: EditorSkillPage = {
  name: skillDocument("motion-design/references/taste.md").name,
  description: skillDocument("motion-design/references/taste.md").description,
  body: skillText("motion-design/references/taste.md"),
};
