import { skillText, skillDocument } from '../documents';
import type { EditorSkill, EditorSkillPage } from '../index';
import { SCENE_GSAP_PLUGINS } from '../../../editor/scene-modules';
import { GREENSOCK_PAGES } from './pages';
import { TRANSITION_RECIPE_PAGES } from './recipes';

/** Revline's rules for GSAP in scenes. They come first and win over anything in GreenSock's pages. */
const RULES = skillText("gsap/SKILL.md", [SCENE_GSAP_PLUGINS.join(', ')]);

const rulesPage: EditorSkillPage = { name: 'revline', description: 'Read first: how GSAP works in Revline scenes (paused, seeked timelines; useTimeline; what never to use). Wins over the GreenSock pages.', body: RULES };

export const gsapSkill: EditorSkill = {
  name: skillDocument("gsap/SKILL.md").name,
  description: skillDocument("gsap/SKILL.md").description,
  body: RULES,
  pages: [rulesPage, ...TRANSITION_RECIPE_PAGES, ...GREENSOCK_PAGES],
};
