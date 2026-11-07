import { talkingHeadGraphics } from './talking-head-graphics';
import { visualInspection } from './visual-inspection';
import { writingScenes } from './writing-scenes';
import { launchFilmsMotions } from './launch-films-motions';
import { remakingVideos } from './remaking-videos';
import { gsapSkill } from './gsap';
import { footageEditing } from './footage-editing';
import { clipping } from './clipping';
import { music } from './music';
import { transitions } from './transitions';
import type { EditorSkill } from './types';

export const editorSkills = ():EditorSkill[] => [footageEditing, clipping, music, writingScenes, gsapSkill, talkingHeadGraphics, launchFilmsMotions, transitions, remakingVideos, visualInspection];
