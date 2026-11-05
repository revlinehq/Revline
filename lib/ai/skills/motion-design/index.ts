import { skillText, skillDocument } from '../documents';
import type { EditorSkill } from '../types';
import { blueprintsPage, brandPage } from './pages';
import { imagePlatesPage } from './image-plates';
import { ideationPage } from './ideation';
import { backgroundsPage } from './backgrounds';
import { TRANSITION_RECIPE_PAGES } from './recipes';

export const motionDesign: EditorSkill = {
  name: skillDocument("motion-design/SKILL.md").name,
  description: skillDocument("motion-design/SKILL.md").description,
  body: skillText("motion-design/SKILL.md"),
  pages: [ideationPage, backgroundsPage, brandPage, blueprintsPage, imagePlatesPage, ...TRANSITION_RECIPE_PAGES],
};
