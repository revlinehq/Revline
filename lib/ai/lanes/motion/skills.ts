import { vfx } from '../../skills/vfx';
import { vfxRecipes } from '../../skills/vfx-recipes';
import { footageEditing } from '../../skills/footage-editing';
import { effects } from '../../skills/effects';
import { textStyling } from '../../skills/text-styling';
import { colorGrading } from '../../skills/color-grading';
import { musicAndSound } from '../../skills/music-and-sound';
import { motionDesign } from '../../skills/motion-design';
import { gsapSkill } from '../../skills/gsap';
import { sceneEngine } from '../../skills/scene-engine';
import { referenceFootage } from '../../skills/reference-footage';
export const skills = [
  vfx,
  vfxRecipes,
  footageEditing,
  effects,
  textStyling,
  colorGrading,
  musicAndSound,
  motionDesign,
  gsapSkill,
  sceneEngine,
  { ...referenceFootage, body: 'For a film already bound to a reference, read page recreation. A new reference remake belongs in the recreate lane.', pages: referenceFootage.pages?.filter(page => page.name === 'recreation') },
];
