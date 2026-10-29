import { SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import { SCENE_GSAP_PLUGINS } from '../../editor/scene-modules';
import type { EditorSkill, EditorSkillPage } from './index';

const reactScenesPage: EditorSkillPage = {
  name: 'react-scenes',
  description: 'React scenes: the format for launch and feature films. Components for structure (one per part, one clip per beat), GSAP for motion through useTimeline, transition clips between beats, the revline module.',
  body: `# React scenes

A React scene is a TSX module whose default export is a component. It is a React scene because it imports from \`'revline'\`. Structure is React (components, one clip per beat); motion is GSAP, seeked by the frame clock. The engine renders the tree for each frame, so preview, scrubbing and export draw the same frames.

## Structure
- **One clip per beat.** Each beat of the film (the dashboard building, the composer, the threads, the lockup) is its own scene clip on V2, so feedback on one beat edits one clip. Beat clips sit back to back.
- **One component per part.** Rebuild the product UI as components named for what they are (\`Sidebar\`, \`Composer\`, \`ThreadList\`, \`DiffPanel\`), composed by an app component. The inspector lists the components each clip draws, so names matter. Write the components once and use the identical code in every beat clip that shows them.
- **Anchors.** Mark parts a transition may fly into with \`data-anchor="composer"\`, and the element the camera moves (the app window, not the titles over it) with \`data-camera\`.
- **Transitions are clips.** A camera move or crossfade between two beats is its own clip on the layer above the cut (V3), drawing \`<Transition>\`: \`kind\` is \`zoom-into\` (into an anchor of the outgoing beat), \`pull-back\` (out of an anchor of the incoming beat), \`crossfade\` or \`blur-through\`; \`target\` names the anchor; \`zoom\`, \`at\` (where the anchor lands, as fractions of the frame), \`origin\` (point in the anchor), \`fade\` (crossfade window, fractions) and \`ease\` tune it. It draws both neighbouring beat clips on their own clocks; give the incoming beat a first frame that matches where the camera ends.

## Motion
- **Simple fades and slides:** compute from time. \`const { time } = useBeat()\` (local to the clip, or to the nearest \`<Beat>\`), then \`progress(time, start, duration, 'expo.out')\` (eased 0..1) and \`mix(from, to, p)\` into style (opacity from \`p\`, a translateY from \`mix(24, 0, p)\`).
- **Choreography** (staggers, overlaps, word-by-word or letter reveals, SplitText, ScrambleText, DrawSVG, MorphSVG, motion paths): \`useTimeline\`. It builds a paused GSAP timeline once per mount, scoped to the element it returns a ref for, and seeks it to the beat's local time on every frame:
\`\`\`tsx
function Title({ text }: { text: string }) {
  const ref = useTimeline<HTMLHeadingElement>((tl, el) => {
    const { words } = new SplitText(el, { type: 'words' });
    tl.from(words, { opacity: 0, filter: 'blur(14px)', y: 18, duration: .8, ease: 'expo.out', stagger: .07 }, .2);
  });
  return <h1 ref={ref} style={{ margin: 0, font: '600 84px/1.05 Outfit' }}>{text}</h1>;
}
\`\`\`
  Selector strings inside \`build\` (\`tl.from('.row', …)\`) find only that component's nodes. Let GSAP animate nodes whose style React does not set every render; keep React-computed style and GSAP on different elements.
- **Never** \`gsap.to\`, \`gsap.from\` or \`gsap.set\` outside a useTimeline build, CSS transitions or keyframe animations, timers, requestAnimationFrame, Date or component state that changes over time. None of them follow the frame clock, so they differ between preview, scrubbing and export.
- **No flash frames:** a part hidden at its first frame starts hidden through its timeline (\`tl.from\`/\`tl.fromTo\` apply their start state where the timeline is built) or through computed style at time 0. Beats unmount what is outside their window, so build hidden parts where they first appear.

## The revline module
- \`useBeat()\`: \`{ time, frame, fps, start, duration, progress }\` local to the nearest beat. \`useBeat(t => …)\` re-renders only when the selected value changes (\`useBeat(t => t.time > 2)\`).
- \`useScene()\`: \`{ width, height, fps, duration, brand, media }\`; also the scene component's props.
- \`useTimeline((tl, el) => …, deps?)\`: GSAP choreography on the beat clock; returns the ref.
- \`<Beat id start duration track keep>\`: a stretch with its own clock inside one clip. \`start\` is seconds or a reference to an earlier sibling: \`"intro"\`, \`"intro + 0.5"\`, \`"intro - 0.3"\`. Outside its window it renders nothing (\`keep\` keeps it mounted, hidden).
- \`<Layer>\`: full-frame box. \`<Still>\`: children rendered once. \`<Icon name size color strokeWidth>\`: a Lucide icon.
- \`progress\`, \`mix\`, \`ramp(t, times, values, ease)\`, \`spring(t, { from, to, stiffness, damping })\`, \`ease(name)\`: eases use GSAP names.
- \`<Transition>\` and \`<Neighbour role="from" | "to">\` for transition clips. \`waitFor(promise)\` holds a frame until it settles.
- Imports: \`revline\`, \`react\` and \`gsap\` with its plugins (\`gsap/SplitText\` etc.). Fonts, media, icons and the brand work as in GSAP scenes.

## Performance
Only components that read time re-render; static parts render once. A useTimeline component does not re-render per frame. Keep heavy static UI in components that never call useBeat, wrap big static subtrees in \`<Still>\`, and prefer \`useBeat(select)\` in hot components.`,
};

export const sceneEngine: EditorSkill = {
  name: 'scene-engine',
  description: 'How scene clips work, for every kind of scene: the module contract, what loads, how frames are rendered, GSAP technique, fonts, images and the brand parameter. Read before the first addScene or editScene, together with the skill for the job (motion-design for launch and feature films, explainer-scenes for explainers and overlays on footage).',
  body: `# Scene engine

A scene is a TypeScript module that builds plain HTML once and choreographs it on a GSAP timeline. It renders full-frame on its own V layer, inside a sandbox, and the editor renders it frame by frame for preview and export. Transparent areas show the layers below.

Launch and feature films use **React scenes** instead: components for structure, one clip per beat, GSAP motion seeked through useTimeline (page \`react-scenes\`). The rest of this page describes GSAP scenes, used for explainers and overlays on footage.

## Writing scenes
- Plan the film as a short outline (a few lines per scene: time range, what moves, the words). Never draft scene code while thinking; write it in the addScene call. A turn has one output budget for thinking and the call together, and a long draft in thinking leaves nothing for the scene.
- Build a long film as several scenes, one addScene per call, and check each before writing the next. Keep each module well under the code limit.

## Contract

- Write \`export default function scene({ root, tl, gsap, width, height, duration, fps, brand, media, icon, blueprint })\`. It runs once, before the first frame.
- \`root\` is the full-frame container on the 1080-based canvas (\`width\` x \`height\` px). Build inside it with \`root.innerHTML\` or \`document.createElement\`; never restyle \`root\` itself. Position with absolute px or percentages.
- \`tl\` is the scene's GSAP timeline. Time 0 is the clip's first frame, in seconds. Put every animation on it with a position parameter: \`tl.from(el, { y: 40, opacity: 0, duration: .8, ease: 'expo.out' }, 1.2)\`.
- \`media\` holds the project images attached with addScene/editScene \`media\` (see Project media), by name.
- \`icon('scissors', { size: 16, color: '#8d8f93', strokeWidth: 2 })\` returns a Lucide icon as SVG markup (kebab-case names, as on lucide.dev). Use it for every UI icon instead of drawing one.
- \`blueprint('Editor', container, { width, height })\` builds a brand kit blueprint attached with \`blueprints\` inside \`container\` and returns its root; animate its \`[data-part=...]\` pieces (motion-design, blueprints page).
- \`brand\` is the brand kit attached with brandKitId (fonts already loaded, named colors, logo), or null. See motion-design's \`brand-kit\` page.
- The editor seeks the timeline to each frame, so the film is scrubbable and exports frame-exact. Animate only with GSAP. CSS transitions and keyframes, requestAnimationFrame, timers, Date, video and audio do not follow the clock.
- GSAP scenes are plain TypeScript, not JSX (React scenes, page \`react-scenes\`, are TSX). Imports: \`gsap\` and its plugins (${SCENE_GSAP_PLUGINS.join(', ')}, plus EasePack), each from \`gsap/<Name>\` or all from \`gsap\`. They are registered already. Nothing else loads: no network, no other packages.
- Math.random is seeded, so scatter and noise come out the same in preview and export.
- Limits: code up to 20,000 characters, clips up to 120 s.

## GSAP technique

- Choreograph with the position parameter: absolute times (\`2.4\`), relative to the previous step (\`'<0.2'\`, \`'-=0.3'\`), or labels (\`tl.addLabel('reveal', 3)\`, then \`'reveal+=0.4'\`).
- A custom curve is one line: \`CustomEase.create('brand', 'M0,0 C0.4,0 0.2,1 1,1')\`.
- \`stagger\` builds lists, grids, words and characters: \`tl.from(items, { y: 20, opacity: 0, stagger: 0.06 }, 1)\`.
- Text: \`new SplitText(el, { type: 'lines,words,chars' })\` splits for line, word or character reveals; ScrambleTextPlugin decodes text; TextPlugin types it.
- Lines and shapes: DrawSVGPlugin draws strokes (\`drawSVG: '0%'\` to \`'100%'\`), MorphSVGPlugin morphs paths, MotionPathPlugin moves along a path.
- Counting numbers: tween a plain object and write it out in \`onUpdate\`.
- Loops: \`repeat: -1\` with \`yoyo: true\` for drifts, pulses and backgrounds; they stay frame-exact.
- Instant changes (a swap, a hard cut inside a scene, a stepped frame rate): \`tl.set(...)\` at a time, or \`ease: 'steps(n)'\`.
- Rebuild product UI as real HTML (cards, rows, buttons, charts) rather than describing it; it stays sharp at any resolution and every part can move.
- Blur, masks and 3D work: \`filter: blur()\`, \`mask-image\` gradients, and \`perspective\` with rotateX/rotateY on a parent.

## Fonts and images

- \`font-family\` may be any of: ${SCENE_FONT_FAMILIES.join(', ')}, or the brand kit's families when one is attached.
- Images come from \`media\` (see Project media) or are inline SVG or data: URIs; nothing loads from the network. The brand logo arrives as \`brand.logo\` (data URL) and \`brand.logoSvg\` (markup when vector).

## Project media
Real screenshots, screen recordings, photos and logos from the project's media can appear inside a scene:
- Use the project's media (the user adds files in the editor; over MCP, uploadMedia adds them and getProject lists them). Images (png, jpg, webp) and videos up to 2 minutes.
- Attach them by name: addScene or editScene with \`media: [{ name: 'editor', assetId: '…' }]\` (up to 8). A brand kit's saved screens also arrive in \`media\` when the kit is attached; a project item with the same name wins.
- In code, \`media.editor\` is a URL: \`<img src="\${media.editor}">\`, \`<video src="\${media.demo}">\` or \`background-image:url(\${media.editor})\`. It is undefined if the file is missing, so keep a fallback.
- Videos follow the scene clock, frame-exact, and are always muted (sound belongs on audio clips): \`data-start\` is the scene second the video begins (default 0), \`data-offset\` the source second it starts from, \`data-rate\` its speed, \`data-loop\` loops it. Do not call play(); the engine seeks it.
- Treat media like any element: crop it with a wrapper and \`overflow:hidden\`, zoom with scale and transform-origin, tilt it with perspective, mask it, blur it, stack copies.
- Media is loaded before the first frame, in preview and in exports.

## Checking a scene

- Scenes are not effects: never call planEffects or previewRender for a scene clip.
- Walk through the timeline's key times in your code (start, each beat, the end): what is on screen at each, that text stays inside the frame, that nothing pops at a cut.
- Over MCP, getFrames renders the saved timeline at chosen times: use it to look at your scenes.

## Example

\`\`\`ts
${STARTER_SCENE_CODE}\`\`\`
`,
  pages: [reactScenesPage],
};
