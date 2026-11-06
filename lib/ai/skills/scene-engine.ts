import { skillText, skillDocument } from './documents';
import { SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import { SCENE_GSAP_PLUGINS } from '../../editor/scene-modules';
import type { EditorSkill, EditorSkillPage } from './types';

const editLanesPage: EditorSkillPage = {
  name: skillDocument("scene-engine/references/edit-lanes.md").name,
  description: skillDocument("scene-engine/references/edit-lanes.md").description,
  body: skillText("scene-engine/references/edit-lanes.md"),
};

/** The one list of checks before a scene or film goes back to the user. Other skills point here. */
const checklistPage: EditorSkillPage = {
  name: skillDocument("scene-engine/references/checklist.md").name,
  description: skillDocument("scene-engine/references/checklist.md").description,
  body: skillText("scene-engine/references/checklist.md"),
};

const filmsPage: EditorSkillPage = {
  name: skillDocument("scene-engine/references/films.md").name,
  description: skillDocument("scene-engine/references/films.md").description,
  body: skillText("scene-engine/references/films.md"),
};

export const sceneEngine: EditorSkill = {
  name: skillDocument("scene-engine/SKILL.md").name,
  description: skillDocument("scene-engine/SKILL.md").description,
  body: skillText("scene-engine/SKILL.md", [SCENE_GSAP_PLUGINS.join(', '), SCENE_FONT_FAMILIES.join(', '), STARTER_SCENE_CODE]),
  pages: [editLanesPage, filmsPage, checklistPage],
};
