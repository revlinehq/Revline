import { skillText, skillDocument } from './documents';
import type { EditorSkill } from './index';
import { EFFECT_RULES } from '../editor-style';

// The footage-editing procedures that used to sit in the app's system prompt, moved here word for word so the prompt
// stays neutral between footage edits and motion films.
export const footageEditing: EditorSkill = {
  name: skillDocument("footage-editing/SKILL.md").name,
  description: skillDocument("footage-editing/SKILL.md").description,
  body: skillText("footage-editing/SKILL.md", [EFFECT_RULES]),
};
