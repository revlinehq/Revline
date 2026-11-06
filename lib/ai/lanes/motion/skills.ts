import { launchFilmsMotions } from '../../skills/launch-films-motions';
import { gsapSkill } from '../../skills/gsap';
import { writingScenes } from '../../skills/writing-scenes';
import { remakingVideos } from '../../skills/remaking-videos';
// Films made from scratch read only the film skills; footage, caption and sound-effect skills belong to the footage lanes.
export const skills = [
  launchFilmsMotions,
  gsapSkill,
  writingScenes,
  { ...remakingVideos, body: 'For a film already bound to a reference, read page recreation. A new reference remake belongs in the recreate lane.', pages: remakingVideos.pages?.filter(page => page.name === 'recreation') },
];
