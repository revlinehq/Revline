import { skillText, skillDocument } from './documents';
import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './types';

let body: string | undefined;

// Built on first read, so importing the skills does not build the capability catalog on every cold start.
export const effects: EditorSkill = {
  name: skillDocument("effects/SKILL.md").name,
  description: skillDocument("effects/SKILL.md").description,
  get body() {
    if (body === undefined) {
      const { soundEffects: _sound, text: _text, captions: _captions, ...catalog } = editorCapabilities();
      body = skillText("effects/SKILL.md", [JSON.stringify(catalog)]);
    }
    return body;
  },
};
