import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

const example = skillText("talking-head-graphics/references/example.md");

export const talkingHeadGraphics: EditorSkill = {
  name: skillDocument("talking-head-graphics/SKILL.md").name,
  description: skillDocument("talking-head-graphics/SKILL.md").description,
  body: skillText("talking-head-graphics/SKILL.md"),
  pages: [{ name: 'example', description: 'A complete scene module in the isometric line diagram style (stacked blocks, accent edge, dimension line, caption), plus how to draw charts, bars, counters and structures the same way.', body: example }],
};
