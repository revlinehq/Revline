import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './types';
import { imagePlatesPage } from './launch-films-motions/image-plates';

const recreation: EditorSkillPage = {
  name: skillDocument("remaking-videos/references/recreation.md").name,
  description: skillDocument("remaking-videos/references/recreation.md").description,
  body: skillText("remaking-videos/references/recreation.md"),
};

const socialEdit: EditorSkillPage = {
  name: skillDocument("remaking-videos/references/social-edit.md").name,
  description: skillDocument("remaking-videos/references/social-edit.md").description,
  body: skillText("remaking-videos/references/social-edit.md"),
};

const motivation: EditorSkillPage = {
  name: skillDocument("remaking-videos/references/motivation.md").name,
  description: skillDocument("remaking-videos/references/motivation.md").description,
  body: skillText("remaking-videos/references/motivation.md"),
};

const borrow: EditorSkillPage = {
  name: skillDocument("remaking-videos/references/borrow.md").name,
  description: skillDocument("remaking-videos/references/borrow.md").description,
  body: skillText("remaking-videos/references/borrow.md"),
};

export const remakingVideos: EditorSkill = {
  name: skillDocument("remaking-videos/SKILL.md").name,
  description: skillDocument("remaking-videos/SKILL.md").description,
  body: skillText("remaking-videos/SKILL.md"),
  pages: [recreation, socialEdit, motivation, borrow, imagePlatesPage],
};
