import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './index';

export const CLIPPING_SKILL_ROUTING = 'For finding or making short clips from a longer source, load readSkill name "clipping" before the work. Route by intent, including "clip this", "make clips", "turn this into shorts", "find the best moments", or a long stream, podcast or VOD link (Twitch, Kick, YouTube) with a short-form ask. A link alone is not a clipping request. Small edits to an existing clip follow scene-engine page "edit-lanes"; do not restart a whole-source search.';

const moments: EditorSkillPage = {
  name: skillDocument("clipping/references/moments.md").name,
  description: skillDocument("clipping/references/moments.md").description,
  body: skillText("clipping/references/moments.md"),
};

const framing: EditorSkillPage = {
  name: skillDocument("clipping/references/framing.md").name,
  description: skillDocument("clipping/references/framing.md").description,
  body: skillText("clipping/references/framing.md"),
};

const batching: EditorSkillPage = {
  name: skillDocument("clipping/references/batching.md").name,
  description: skillDocument("clipping/references/batching.md").description,
  body: skillText("clipping/references/batching.md"),
};

const finishing: EditorSkillPage = {
  name: skillDocument("clipping/references/finishing.md").name,
  description: skillDocument("clipping/references/finishing.md").description,
  body: skillText("clipping/references/finishing.md"),
};

export const clipping: EditorSkill = {
  name: skillDocument("clipping/SKILL.md").name,
  description: skillDocument("clipping/SKILL.md").description,
  body: skillText("clipping/SKILL.md"),
  pages: [moments, framing, batching, finishing],
};
