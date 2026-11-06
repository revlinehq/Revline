import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './types';
import { EFFECT_RULES } from '../editor-style';
import { editorCapabilities } from '../editor-capabilities';

let textStylingBody: string | undefined;

// Built on first read, so importing the skills does not build the capability catalog on every cold start.
const textStyling: EditorSkillPage = {
  name: skillDocument("footage-editing/references/text-styling.md").name,
  description: skillDocument("footage-editing/references/text-styling.md").description,
  get body() {
    if (textStylingBody === undefined) {
      const { text, captions } = editorCapabilities();
      textStylingBody = skillText("footage-editing/references/text-styling.md", [JSON.stringify({ text, captions })]);
    }
    return textStylingBody;
  },
};

// The footage-editing procedures that used to sit in the app's system prompt, moved here word for word so the prompt
// stays neutral between footage edits and motion films.
export const footageEditing: EditorSkill = {
  name: skillDocument("footage-editing/SKILL.md").name,
  description: skillDocument("footage-editing/SKILL.md").description,
  body: skillText("footage-editing/SKILL.md", [EFFECT_RULES]),
  pages: [textStyling],
};
