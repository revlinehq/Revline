import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './types';

const example = skillText("overall-styling/references/example.md");

export const overallStyling: EditorSkill = {
  name: skillDocument("overall-styling/SKILL.md").name,
  description: skillDocument("overall-styling/SKILL.md").description,
  body: skillText("overall-styling/SKILL.md"),
  pages: [{ name: 'example', description: 'A complete scene module in the isometric line diagram style (stacked blocks, accent edge, dimension line, caption), plus how to draw charts, bars, counters and structures the same way.', body: example }],
};
