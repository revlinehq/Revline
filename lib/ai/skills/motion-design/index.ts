import { skillText, skillDocument } from '../documents';
import type { EditorSkill } from '../types';
import { blueprintsPage, brandPage } from './pages';
import { imagePlatesPage } from './image-plates';
import { tastePage } from './taste';
import { ideationPage } from './ideation';

export const motionDesign: EditorSkill = {
  name: skillDocument("motion-design/SKILL.md").name,
  description: skillDocument("motion-design/SKILL.md").description,
  body: skillText("motion-design/SKILL.md"),
  pages: [ideationPage, tastePage, brandPage, blueprintsPage, imagePlatesPage],
};
