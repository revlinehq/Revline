import { explainerScenes } from './explainer-scenes';
import { musicAndSound } from './music-and-sound';
import { effects } from './effects';
import { textStyling } from './text-styling';
import { vfxRecipes } from './vfx-recipes';
import { visualInspection } from './visual-inspection';
import { colorGrading } from './color-grading';
import { brandKit } from './brand-kit';
import { launchFilms } from './launch-films';
import { launchStyles } from './launch-styles';

/** Format-specific instructions the assistant loads on demand with readSkill. */
/** Long skills keep a short main body and load deeper pages only when a job needs them. */
export type EditorSkillPage = { name: string; description: string; body: string };
export type EditorSkill = { name: string; description: string; body: string; pages?: EditorSkillPage[] };

export const EDITOR_SKILLS: EditorSkill[] = [effects, vfxRecipes, textStyling, colorGrading, explainerScenes, launchFilms, launchStyles, brandKit, musicAndSound, visualInspection];
export const EDITOR_SKILL_NAMES = EDITOR_SKILLS.map(skill => skill.name) as [string, ...string[]];

/** The always-visible index: names and when to read each skill. */
export function editorSkillIndex() {
  return EDITOR_SKILLS.map(({ name, description }) => ({ name, description }));
}

export function editorSkill(name: string) {
  const skill = EDITOR_SKILLS.find(item => item.name === name);
  if (!skill) throw new Error(`Unknown skill "${name}". Available: ${EDITOR_SKILL_NAMES.join(', ')}.`);
  return skill;
}

/** The main body lists its pages; a page name returns that page alone. */
export function editorSkillInstructions(name: string, page?: string) {
  const skill = editorSkill(name);
  if (page) {
    const found = skill.pages?.find(item => item.name === page);
    if (!found) throw new Error(`Skill "${name}" has no page "${page}". Pages: ${skill.pages?.map(item => item.name).join(', ') || 'none'}.`);
    return found.body;
  }
  if (!skill.pages?.length) return skill.body;
  return `${skill.body}\n\n## Pages\n\nLoad one with readSkill name "${skill.name}" and page:\n${skill.pages.map(item => `- \`${item.name}\`: ${item.description}`).join('\n')}`;
}
