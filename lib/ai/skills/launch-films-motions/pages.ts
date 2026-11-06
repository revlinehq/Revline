import { skillText, skillDocument } from '../documents';
import type { EditorSkillPage } from '../types';

/** A new film for the user's own brand starts here: nothing is designed before the brand is known. */
export const brandPage: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/brand-kit.md").name,
  description: skillDocument("launch-films-motions/references/brand-kit.md").description,
  body: skillText("launch-films-motions/references/brand-kit.md"),
};

export const blueprintsPage: EditorSkillPage = {
  name: skillDocument("launch-films-motions/references/blueprints.md").name,
  description: skillDocument("launch-films-motions/references/blueprints.md").description,
  body: skillText("launch-films-motions/references/blueprints.md"),
};
