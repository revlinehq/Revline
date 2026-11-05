import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../index';

/** A new film for the user's own brand starts here: nothing is designed before the brand is known. */
export const brandPage: EditorSkillPage = {
  name: skillDocument("motion-design/references/brand-kit.md").name,
  description: skillDocument("motion-design/references/brand-kit.md").description,
  body: skillText("motion-design/references/brand-kit.md"),
};

export const blueprintsPage: EditorSkillPage = {
  name: skillDocument("motion-design/references/blueprints.md").name,
  description: skillDocument("motion-design/references/blueprints.md").description,
  body: skillText("motion-design/references/blueprints.md"),
};
