import { skillText, skillDocument } from './documents';
import { editorCapabilities } from '../editor-capabilities';
import type { EditorSkill } from './types';

const { soundEffects: _sound, text: _text, captions: _captions, ...catalog } = editorCapabilities();

export const effects: EditorSkill = {
  name: skillDocument("effects/SKILL.md").name,
  description: skillDocument("effects/SKILL.md").description,
  body: skillText("effects/SKILL.md", [JSON.stringify(catalog)]),
};
