import { skillText, skillDocument } from '../documents';
import type { EditorSkill } from '../types';
import { blueprintsPage, brandPage } from './pages';
import { imagePlatesPage } from './image-plates';
import { ideationPage } from './ideation';
import { backgroundsPage } from './backgrounds';

export const launchFilmsMotions: EditorSkill = {
  name: skillDocument("launch-films-motions/SKILL.md").name,
  description: skillDocument("launch-films-motions/SKILL.md").description,
  body: skillText("launch-films-motions/SKILL.md"),
  pages: [ideationPage, backgroundsPage, brandPage, blueprintsPage, imagePlatesPage],
};
