import { talkingHeadGraphics } from './talking-head-graphics';
import { visualInspection } from './visual-inspection';
import { footageEditing } from './footage-editing';
import { clipping } from './clipping';
import { music } from './music';
import { transitions } from './transitions';
import type { EditorSkill } from './types';

export const editorSkills = ():EditorSkill[] => [footageEditing, clipping, music, talkingHeadGraphics, transitions, visualInspection];
