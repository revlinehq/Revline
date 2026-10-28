import { explainerScenes } from './explainer-scenes';
import { musicAndSound } from './music-and-sound';
import { effects } from './effects';
import { textStyling } from './text-styling';
import { vfxRecipes } from './vfx-recipes';
import { visualInspection } from './visual-inspection';
import { colorGrading } from './color-grading';

/** Format-specific instructions the assistant loads on demand with readSkill. */
export type EditorSkill = { name: string; description: string; body: string };

export const EDITOR_SKILLS: EditorSkill[] = [effects, vfxRecipes, textStyling, colorGrading, explainerScenes, musicAndSound, visualInspection];
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
