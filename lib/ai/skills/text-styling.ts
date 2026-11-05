import { skillText, skillDocument } from './documents';
import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './types';

const { text, captions } = editorCapabilities();

export const textStyling: EditorSkill = {
  name: skillDocument("text-styling/SKILL.md").name,
  description: skillDocument("text-styling/SKILL.md").description,
  body: skillText("text-styling/SKILL.md", [JSON.stringify({ text, captions })]),
};
