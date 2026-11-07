import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './types';

const page = (path: string): EditorSkillPage => ({ name: skillDocument(path).name, description: skillDocument(path).description, body: skillText(path) });

export const genesis: EditorSkill = {
  name: skillDocument("genesis/SKILL.md").name,
  description: skillDocument("genesis/SKILL.md").description,
  body: skillText("genesis/SKILL.md"),
  pages: [page("genesis/references/remove.md"), page("genesis/references/speed.md"), page("genesis/references/replace.md")],
};
