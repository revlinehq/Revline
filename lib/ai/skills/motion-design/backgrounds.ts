import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

export const backgroundsPage: EditorSkillPage = {
  name: skillDocument("motion-design/references/backgrounds.md").name,
  description: skillDocument("motion-design/references/backgrounds.md").description,
  body: skillText("motion-design/references/backgrounds.md"),
};
