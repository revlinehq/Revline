import type { EditorSkill } from './index';

export const explainerScenes: EditorSkill = {
  name: 'explainer-scenes',
  description: 'Explainer visuals and overlays on footage: titles, diagrams, charts, UI walkthroughs, kinetic type and animated callouts that support a video someone is talking in. Read with scene-engine before addScene or editScene for these. Standalone motion design with no footage (launch films, product or feature reels, teasers, recreating a motion film or reference) uses motion-design instead. Scenes come with matching generated sound (see Sound).',
  body: `# Explainer scenes

An explainer scene is one beat of a video that already has a story, usually someone talking: it shows what they are saying. Read scene-engine for how scenes work; this skill is how to make them explain.

## Over footage

- Leave the background transparent when the scene sits over footage; only draw what the beat needs, and keep the speaker's face clear.
- Key the scene's beats to the transcript: the moment a word is said is when its visual lands. Read the words' times with inspectAssetAnalysis.
- Enter as the idea starts, leave before the next idea, so overlays never pile up.

## Craft

1. Plan the beats before code: one scene per idea, one message per scene. Write the beat times first and key all choreography to them.
2. Keep something moving: a slow push-in across the whole scene, a build or a draw-on. A frozen overlay over moving footage reads as a bug.
3. Hold readable text at least 2 seconds before replacing it. Show one caption line at a time.
4. Give elements context (a UI card, a chart axis, a device frame) instead of shapes floating in empty space.
5. Establish, then zoom: open wide on the setting, then push in on the action.
6. Match the cut: end on a stable frame and start the next scene from a compatible layout so nothing pops between beats.
7. Keep text inside the central 80% of the frame.
8. One title per scene. Never put a small label, eyebrow or kicker line (such as "EDITING TIME") above or on top of the main title; let the title stand alone.
9. One motion vocabulary per video: entrances \`expo.out\` (0.6 to 0.9 s), moves \`power3.inOut\`, pops \`back.out(1.7)\` (0.45 s), drifts \`none\` or \`sine.inOut\`.

## Sound

Every scene you create, or whose choreography you substantially change, gets matching sound in the same turn without being asked. Read the music-and-sound skill, then:

- After addScene, call generateSound once for that scene: one clip at the scene's start, layers keyed to its key beats (the times of its main tweens and labels). Only the key beats, not every element.
- After patchScene or editScene changes timing or motion, update that scene's existing generated sound with editSound (find it by start time and inspectClip's soundRecipe) instead of adding a second clip. Leave sounds alone for scenes whose motion did not change, and for text-only or color edits.
- Skip sound when the user asked for no sound or a silent edit, or when speech (transcript words) or a music-role clip plays under the scene; say that you skipped it and why.

## Verifying

If the user asks to check a scene visually, walk through its key times (scene-engine, Checking a scene) and say they can scrub it in the preview.`,
};
