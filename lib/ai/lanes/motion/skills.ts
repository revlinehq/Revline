import { motionDesign } from '../../skills/motion-design';
import { gsapSkill } from '../../skills/gsap';
import { sceneEngine } from '../../skills/scene-engine';
import { referenceFootage } from '../../skills/reference-footage';
// Films made from scratch read only the film skills; footage, caption and sound-effect skills belong to the footage lanes.
export const skills = [
  motionDesign,
  gsapSkill,
  sceneEngine,
  { ...referenceFootage, body: 'For a film already bound to a reference, read page recreation. A new reference remake belongs in the recreate lane.', pages: referenceFootage.pages?.filter(page => page.name === 'recreation') },
];
