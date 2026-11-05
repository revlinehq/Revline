import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './index';
import { imagePlatesPage } from './motion-design/image-plates';

const recreation: EditorSkillPage = {
  name: skillDocument("reference-footage/references/recreation.md").name,
  description: skillDocument("reference-footage/references/recreation.md").description,
  body: skillText("reference-footage/references/recreation.md"),
};

const socialEdit: EditorSkillPage = {
  name: skillDocument("reference-footage/references/social-edit.md").name,
  description: skillDocument("reference-footage/references/social-edit.md").description,
  body: skillText("reference-footage/references/social-edit.md"),
};

const motivation: EditorSkillPage = {
  name: skillDocument("reference-footage/references/motivation.md").name,
  description: skillDocument("reference-footage/references/motivation.md").description,
  body: skillText("reference-footage/references/motivation.md"),
};

const borrow: EditorSkillPage = {
  name: skillDocument("reference-footage/references/borrow.md").name,
  description: skillDocument("reference-footage/references/borrow.md").description,
  body: skillText("reference-footage/references/borrow.md"),
};

export const referenceFootage: EditorSkill = {
  name: skillDocument("reference-footage/SKILL.md").name,
  description: skillDocument("reference-footage/SKILL.md").description,
  body: skillText("reference-footage/SKILL.md"),
  pages: [recreation, socialEdit, motivation, borrow, imagePlatesPage],
};
