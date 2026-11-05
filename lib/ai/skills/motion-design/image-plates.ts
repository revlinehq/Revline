import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../index';

export const imagePlatesPage: EditorSkillPage = {
  name: skillDocument("motion-design/references/image-plates.md").name,
  description: skillDocument("motion-design/references/image-plates.md").description,
  body: skillText("motion-design/references/image-plates.md"),
};
