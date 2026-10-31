import type { EditorSkill } from './index';

export const explainerScenes: EditorSkill = {
  name: 'explainer-scenes',
  description: 'Explainer visuals and overlays on footage: titles, diagrams, charts, UI walkthroughs, kinetic type and animated callouts that support a video someone is talking in. Read with scene-engine before addScene or editScene for these. Standalone motion design with no footage (launch films, product or feature reels, teasers, recreating a motion film or reference) uses motion-design instead. Scenes come with matching generated sound (music-and-sound).',
  body: `# Explainer scenes

An explainer scene is one beat of a video that already has a story, usually someone talking: it shows what they are saying. Read scene-engine for how scenes work; this skill is how to make them explain, and overall-styling is how they look.

## Over footage

- Leave the background transparent when the scene sits over footage; only draw what the beat needs, and keep the speaker's face clear.
- Key the scene's beats to the transcript: the moment a word is said is when its visual lands. Read the words' times with inspectAssetAnalysis.
- Enter as the idea starts, leave before the next idea, so overlays never pile up.

## Sound

Every scene you create, or whose motion you change, gets matching generated sound in the same turn: follow music-and-sound, section Scenes.

## Verifying

If the user asks to check a scene visually, walk through its key times (scene-engine, Checking a scene) and say they can scrub it in the preview.`,
};
