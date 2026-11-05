import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../index';

export const ideationPage: EditorSkillPage = {
  name: skillDocument("motion-design/references/ideation.md").name,
  description: skillDocument("motion-design/references/ideation.md").description,
  body: skillText("motion-design/references/ideation.md"),
};
