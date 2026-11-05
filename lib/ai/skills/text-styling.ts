import { skillText, skillDocument } from './documents';
import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './types';

let body: string | undefined;

// Built on first read, so importing the skills does not build the capability catalog on every cold start.
export const textStyling: EditorSkill = {
  name: skillDocument("text-styling/SKILL.md").name,
  description: skillDocument("text-styling/SKILL.md").description,
  get body() {
    if (body === undefined) {
      const { text, captions } = editorCapabilities();
      body = skillText("text-styling/SKILL.md", [JSON.stringify({ text, captions })]);
    }
    return body;
  },
};
