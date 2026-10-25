import { SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import type { EditorSkill } from './index';

export const explainerScenes: EditorSkill = {
  name: 'explainer-scenes',
  description: 'Write or rewrite scene clips: animated explainer visuals (titles, diagrams, charts, UI walkthroughs, kinetic type) authored as React components and rendered frame by frame. Read before addScene or editScene. Scenes come with matching generated sound (see Sound).',
  body: `# Explainer scenes

A scene is one beat of an explainer: a React component rendered full-frame on its own V layer. Footage below shows through transparent areas, so leave the background transparent when the scene is an overlay.

## Contract

- Write \`export default function Scene()\`. Import only from \`react\` and \`revline\`.
- The module runs in a sandbox with no network, timers or storage. \`Date\` and \`Math.random\` must not drive visuals.
- \`useScene()\` returns \`{ t, frame, fps, duration, width, height, progress }\`. \`t\` is clip-local seconds.
- Compute every visible value from \`t\` during render. Never animate with effects, state, refs or CSS transitions: each frame is rendered on its own when seeking and exporting.
- Author on the fixed canvas from \`useScene()\` (1080-based pixels). Position with absolute px or percentages inside the full-frame root.

## API (from \`revline\`)

- \`useMotion()\` returns the three motion helpers \`enter(start, duration = .6)\`, \`draw(start, duration = .8)\` and \`pop(start, duration = .45)\`. Each gives 0→1 eased progress at the current time. Use only these for movement so a whole video reads as one piece.
- \`interpolate(value, inputRange, outputRange, { easing, clamp = true })\` maps values across keyframes. \`Easing\` has \`linear\`, \`inOutCubic\`, \`outExpo\`, \`outBack\` and \`enter\`/\`draw\`/\`pop\`.
- \`<Show from={a} to={b}>\` is a hard cut: children stay mounted and are visible over [a, b).
- \`<Captions items={[{ at, until?, text }]} />\` shows one caption line at a time.
- \`random(seed)\` returns a deterministic number in [0, 1) for scatter or noise.

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

Every scene you create, or whose choreography you substantially change, gets matching sound in the same turn without being asked. Read the sound-design skill, then:

- After addScene, call generateSound once for that scene: one clip at the scene's start, layers keyed to its key beats (enter, draw, pop and Show times). Only the key beats, not every element.
- After editScene changes timing or motion, update that scene's existing generated sound with editSound (find it by start time and inspectClip's soundRecipe) instead of adding a second clip. Leave sounds alone for scenes whose motion did not change, and for text-only or color edits.
- Skip sound when the user asked for no sound or a silent edit, or when speech (transcript words) or a music-role clip plays under the scene; say that you skipped it and why.

## Verifying a scene

- Scenes are not effects: never call planEffects or previewRender for a scene clip. They cannot review scenes.
- Check your own code instead: walk through the key times (start, each beat, the end) and confirm what is on screen at each, that text stays inside the frame, and that nothing pops at the cut.
- If the user asks to check a scene visually, do that walk-through and say they can scrub it in the preview.

## Fonts

\`fontFamily\` may be any of: ${SCENE_FONT_FAMILIES.join(', ')}. Images must be inline SVG or data: URIs.

## Example

\`\`\`tsx
${STARTER_SCENE_CODE}\`\`\`
`,
};
