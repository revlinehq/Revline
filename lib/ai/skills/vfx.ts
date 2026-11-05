import { skillText, skillDocument } from './documents';
import type { EditorSkill, EditorSkillPage } from './types';

const montage: EditorSkillPage = {
  name: skillDocument("vfx/references/montage.md").name,
  description: skillDocument("vfx/references/montage.md").description,
  body: skillText("vfx/references/montage.md"),
};
const impactAndOverlays: EditorSkillPage = {
  name: skillDocument("vfx/references/impact-and-overlays.md").name,
  description: skillDocument("vfx/references/impact-and-overlays.md").description,
  body: skillText("vfx/references/impact-and-overlays.md"),
};
const parallax: EditorSkillPage = {
  name: skillDocument("vfx/references/parallax.md").name,
  description: skillDocument("vfx/references/parallax.md").description,
  body: skillText("vfx/references/parallax.md"),
};

const tracking: EditorSkillPage = {
  name: skillDocument("vfx/references/tracking.md").name,
  description: skillDocument("vfx/references/tracking.md").description,
  body: skillText("vfx/references/tracking.md"),
};

export const vfx: EditorSkill = {
  name: skillDocument("vfx/SKILL.md").name,
  description: skillDocument("vfx/SKILL.md").description,
  body: skillText("vfx/SKILL.md"),
  pages: [montage, impactAndOverlays, parallax, tracking],
};
