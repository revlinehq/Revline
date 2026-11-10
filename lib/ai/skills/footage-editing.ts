import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './types';
import { EFFECT_RULES } from '../editor-style';
import { editorCapabilities } from '../editor-capabilities';

const page = (path: string, values: readonly string[] = []): EditorSkillPage => ({
  name: skillDocument(path).name,
  description: skillDocument(path).description,
  body: skillText(path, values),
});

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

export const footageEditing: EditorSkill = {
  name: skillDocument("footage-editing/SKILL.md").name,
  description: skillDocument("footage-editing/SKILL.md").description,
  body: skillText("footage-editing/SKILL.md"),
  pages: [page("footage-editing/references/edit-lanes.md"), page("footage-editing/references/speech.md"), textStyling, page("footage-editing/references/layers-and-effects.md", [EFFECT_RULES])],
};
