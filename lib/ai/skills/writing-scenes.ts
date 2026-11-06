import { skillText, skillDocument } from './documents';
import { SCENE_CONTRACT_LIMITS, SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import { SCENE_GSAP_PLUGINS } from '../../editor/scene-modules';
import type { EditorSkill, EditorSkillPage } from './types';

const editLanesPage: EditorSkillPage = {
  name: skillDocument("writing-scenes/references/edit-lanes.md").name,
  description: skillDocument("writing-scenes/references/edit-lanes.md").description,
  body: skillText("writing-scenes/references/edit-lanes.md"),
};

const filmsPage: EditorSkillPage = {
  name: skillDocument("writing-scenes/references/films.md").name,
  description: skillDocument("writing-scenes/references/films.md").description,
  body: skillText("writing-scenes/references/films.md"),
};

export const writingScenes: EditorSkill = {
  name: skillDocument("writing-scenes/SKILL.md").name,
  description: skillDocument("writing-scenes/SKILL.md").description,
  body: skillText("writing-scenes/SKILL.md", [SCENE_GSAP_PLUGINS.join(', '), SCENE_FONT_FAMILIES.join(', '), STARTER_SCENE_CODE, SCENE_CONTRACT_LIMITS.sceneCode.toLocaleString('en-US'), SCENE_CONTRACT_LIMITS.timelineCode.toLocaleString('en-US'), SCENE_CONTRACT_LIMITS.sceneSeconds, SCENE_CONTRACT_LIMITS.filmSeconds]),
  pages: [editLanesPage, filmsPage],
};
