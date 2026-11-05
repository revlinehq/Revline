import { skillText, skillDocument } from './documents';
import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './index';

// Built on read: the catalog module imports the skill index, so this must not run at import time.
export const effects: EditorSkill = {
  name: skillDocument("effects/SKILL.md").name,
  description: skillDocument("effects/SKILL.md").description,
  get body() {
    const { skills: _skills, soundEffects: _sound, text: _text, captions: _captions, ...catalog } = editorCapabilities();
    return skillText("effects/SKILL.md", [JSON.stringify(catalog)]);
  },
};
