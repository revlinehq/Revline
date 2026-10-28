import { SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import { SCENE_GSAP_PLUGINS } from '../../editor/scene-modules';
import type { EditorSkill } from './index';

export const explainerScenes: EditorSkill = {
  name: 'explainer-scenes',
  description: 'Write or rewrite scene clips: animated visuals (titles, diagrams, charts, UI walkthroughs, kinetic type, product and launch films) written as TypeScript modules that build HTML and animate it with GSAP, rendered frame by frame. Read before addScene or editScene. Scenes come with matching generated sound (see Sound).',
  body: `# Explainer scenes

A scene is one beat of a video: a TypeScript module that builds plain HTML once and choreographs it on a GSAP timeline, rendered full-frame on its own V layer. Footage below shows through transparent areas, so leave the background transparent when the scene is an overlay.

## Contract

- Write \`export default function scene({ root, tl, gsap, width, height, duration, fps })\`. It runs once, before the first frame.
- \`root\` is the full-frame container on the 1080-based canvas (\`width\` x \`height\` px). Build inside it with \`root.innerHTML\` or \`document.createElement\`; never restyle \`root\` itself. Position with absolute px or percentages.
- \`tl\` is the scene's GSAP timeline. Time 0 is the clip's first frame, in seconds. Put every animation on it with a position parameter: \`tl.from(el, { y: 40, opacity: 0, duration: .8, ease: 'expo.out' }, 1.2)\`.
- The editor seeks the timeline to each frame, so the whole film is scrubbable and exports frame-exact. Animate only with GSAP. CSS transitions and keyframes, requestAnimationFrame, timers, Date, video and audio do not follow the clock.
- Plain TypeScript, not JSX. Imports: \`gsap\` and its plugins (${SCENE_GSAP_PLUGINS.join(', ')}, plus EasePack), each from \`gsap/<Name>\` or all from \`gsap\`. They are registered already. Nothing else loads: no network, no other packages.
- Math.random is seeded, so scatter and noise come out the same in preview and export.

## GSAP craft

- Choreograph with the position parameter: absolute times (\`2.4\`), relative to the previous step (\`'<0.2'\`, \`'-=0.3'\`), or labels (\`tl.addLabel('reveal', 3)\`, then \`'reveal+=0.4'\`).
- One motion vocabulary per video so it reads as one piece: entrances \`expo.out\` (0.6 to 0.9 s), moves between states \`power3.inOut\`, pops \`back.out(1.7)\` (0.45 s), slow camera drifts \`none\` or \`sine.inOut\`. A brand curve is one line: \`CustomEase.create('brand', 'M0,0 C0.2,0 0,1 1,1')\`.
- \`stagger\` builds lists, grids, words and characters: \`tl.from(items, { y: 20, opacity: 0, stagger: 0.06 }, 1)\`.
- Text: \`new SplitText(el, { type: 'lines,words,chars' })\` splits for line, word or character reveals; ScrambleTextPlugin decodes text; TextPlugin types it.
- Lines and shapes: DrawSVGPlugin draws strokes (\`drawSVG: '0%'\` to \`'100%'\`), MorphSVGPlugin morphs one path into another, MotionPathPlugin moves along a path.
- Counting numbers: tween a plain object and write it out in \`onUpdate\`: \`tl.to(n, { value: 10000, duration: 1.4, onUpdate: () => el.textContent = Math.round(n.value).toLocaleString() }, 2)\`.
- Loops: \`repeat: -1\` with \`yoyo: true\` for drifts, pulses and backgrounds; they stay frame-exact.
- Rebuild product UI as real HTML (cards, rows, buttons, charts) rather than describing it; it stays sharp at any resolution and every part can move.

## Craft

1. Plan the story before code: one scene per beat, one message per scene. Write the beat times first and key all choreography to them.
2. Keep something moving: a slow push-in across the whole scene, a build or a draw-on. A frozen frame reads as a bug.
3. Hold readable text at least 2 seconds before replacing it. Show one caption line at a time.
4. Give elements context (a background, a UI card, a chart axis, a device frame) instead of shapes floating in empty space.
5. Establish, then zoom: open wide on the setting, then push in on the action.
6. Match the cut: end on a stable frame and start the next scene from a compatible layout so nothing pops between beats.
7. Keep text inside the central 80% of the frame.
8. One title per scene. Never put a small label, eyebrow or kicker line (such as "EDITING TIME") above or on top of the main title; let the title stand alone.

## Sound

Every scene you create, or whose choreography you substantially change, gets matching sound in the same turn without being asked. Read the music-and-sound skill, then:

- After addScene, call generateSound once for that scene: one clip at the scene's start, layers keyed to its key beats (the times of its main tweens and labels). Only the key beats, not every element.
- After editScene changes timing or motion, update that scene's existing generated sound with editSound (find it by start time and inspectClip's soundRecipe) instead of adding a second clip. Leave sounds alone for scenes whose motion did not change, and for text-only or color edits.
- Skip sound when the user asked for no sound or a silent edit, or when speech (transcript words) or a music-role clip plays under the scene; say that you skipped it and why.

## Verifying a scene

- Scenes are not effects: never call planEffects or previewRender for a scene clip. They cannot review scenes.
- Check your own code instead: walk through the timeline's key times (start, each beat, the end) and confirm what is on screen at each, that text stays inside the frame, and that nothing pops at the cut.
- If the user asks to check a scene visually, do that walk-through and say they can scrub it in the preview.

## Fonts

\`font-family\` may be any of: ${SCENE_FONT_FAMILIES.join(', ')}. Images must be inline SVG or data: URIs.

## Example

\`\`\`ts
${STARTER_SCENE_CODE}\`\`\`
`,
};
