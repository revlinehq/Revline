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
