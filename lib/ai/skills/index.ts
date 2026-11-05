import { overallStyling } from './overall-styling';
import { musicAndSound } from './music-and-sound';
import { effects } from './effects';
import { textStyling } from './text-styling';
import { vfxRecipes } from './vfx-recipes';
import { visualInspection } from './visual-inspection';
import { colorGrading } from './color-grading';
import { sceneEngine } from './scene-engine';
import { motionDesign } from './motion-design';
import { referenceFootage } from './reference-footage';
import { gsapSkill } from './gsap';
import { footageEditing } from './footage-editing';
import { clipping } from './clipping';
import { vfx } from './vfx';

/** Format-specific instructions the assistant loads on demand with readSkill. */
/** Long skills keep a short main body and load deeper pages only when a job needs them. */
export type EditorSkillPage = { name: string; description: string; body: string };
export type EditorSkill = { name: string; description: string; body: string; pages?: EditorSkillPage[] };

export const editorSkills = ():EditorSkill[] => [footageEditing, clipping, vfx, effects, vfxRecipes, textStyling, colorGrading, sceneEngine, gsapSkill, overallStyling, motionDesign, referenceFootage, musicAndSound, visualInspection];

/** The always-visible index: names and when to read each skill. */
export function editorSkillIndex() {
  return editorSkills().map(({ name, description }) => ({ name, description }));
}

export function editorSkill(name: string) {
  const skill = editorSkills().find(item => item.name === name);
  if (!skill) throw new Error(`Unknown skill "${name}". Available: ${editorSkills().map(skill=>skill.name).join(', ')}.`);
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
