import { skillText, skillDocument } from './documents';
import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './index';

// Built on read: the catalog module imports the skill index, so this must not run at import time.
export const textStyling: EditorSkill = {
  name: skillDocument("text-styling/SKILL.md").name,
  description: skillDocument("text-styling/SKILL.md").description,
  get body() {
    const { text, captions } = editorCapabilities();
    return skillText("text-styling/SKILL.md", [JSON.stringify({ text, captions })]);
  },
};
