import { talkingHeadGraphics } from './talking-head-graphics';
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
import type { EditorSkill } from './types';

export const editorSkills = ():EditorSkill[] => [footageEditing, clipping, vfx, effects, vfxRecipes, textStyling, colorGrading, sceneEngine, gsapSkill, talkingHeadGraphics, motionDesign, referenceFootage, musicAndSound, visualInspection];
