import { talkingHeadGraphics } from './talking-head-graphics';
import { visualInspection } from './visual-inspection';
import { sceneEngine } from './scene-engine';
import { launchFilmsMotions } from './launch-films-motions';
import { referenceFootage } from './reference-footage';
import { gsapSkill } from './gsap';
import { footageEditing } from './footage-editing';
import { clipping } from './clipping';
import type { EditorSkill } from './types';

export const editorSkills = ():EditorSkill[] => [footageEditing, clipping, sceneEngine, gsapSkill, talkingHeadGraphics, launchFilmsMotions, referenceFootage, visualInspection];
