import { SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import { SCENE_GSAP_PLUGINS } from '../../editor/scene-modules';
import type { EditorSkill } from './index';

export const sceneEngine: EditorSkill = {
  name: 'scene-engine',
  description: 'How scene clips work, for every kind of scene: the module contract, what loads, how frames are rendered, GSAP technique, fonts, images and the brand parameter. Read before the first addScene or editScene, together with the skill for the job (motion-design for launch and feature films, explainer-scenes for explainers and overlays on footage).',
  body: `# Scene engine

A scene is a TypeScript module that builds plain HTML once and choreographs it on a GSAP timeline. It renders full-frame on its own V layer, inside a sandbox, and the editor renders it frame by frame for preview and export. Transparent areas show the layers below.

## Contract

- Write \`export default function scene({ root, tl, gsap, width, height, duration, fps, brand, media })\`. It runs once, before the first frame.
- \`root\` is the full-frame container on the 1080-based canvas (\`width\` x \`height\` px). Build inside it with \`root.innerHTML\` or \`document.createElement\`; never restyle \`root\` itself. Position with absolute px or percentages.
- \`tl\` is the scene's GSAP timeline. Time 0 is the clip's first frame, in seconds. Put every animation on it with a position parameter: \`tl.from(el, { y: 40, opacity: 0, duration: .8, ease: 'expo.out' }, 1.2)\`.
- \`media\` holds the project images attached with addScene/editScene \`media\` (see Project media), by name.
- \`brand\` is the brand kit attached with brandKitId (fonts already loaded, named colors, logo), or null. See motion-design's \`brand-kit\` page.
- The editor seeks the timeline to each frame, so the film is scrubbable and exports frame-exact. Animate only with GSAP. CSS transitions and keyframes, requestAnimationFrame, timers, Date, video and audio do not follow the clock.
- Plain TypeScript, not JSX. Imports: \`gsap\` and its plugins (${SCENE_GSAP_PLUGINS.join(', ')}, plus EasePack), each from \`gsap/<Name>\` or all from \`gsap\`. They are registered already. Nothing else loads: no network, no other packages.
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
- Images must be inline SVG or data: URIs. The brand logo arrives as \`brand.logo\` (data URL) and \`brand.logoSvg\` (markup when vector).

## Project media
Real screenshots, photos and logos from the project's media can appear inside a scene:
- Upload the image to the project (uploadMedia) or find it with getProject; only images work (png, jpg, webp), not video.
- Attach it by name: addScene or editScene with \`media: [{ name: 'editor', assetId: '…' }]\` (up to 8).
- In code, \`media.editor\` is a URL: \`<img src="\${media.editor}">\` or \`background-image:url(\${media.editor})\`. It is undefined if the file is missing, so keep a fallback.
- Treat it like any element: crop it with a wrapper and \`overflow:hidden\`, zoom with scale and transform-origin, tilt it with perspective, mask it, blur it, stack copies.
- The image is loaded before the first frame, in preview and in exports.

## Checking a scene

- Scenes are not effects: never call planEffects or previewRender for a scene clip.
- Walk through the timeline's key times in your code (start, each beat, the end): what is on screen at each, that text stays inside the frame, that nothing pops at a cut.
- Over MCP, getFrames renders the saved timeline at chosen times: use it to look at your scenes.

## Example

\`\`\`ts
${STARTER_SCENE_CODE}\`\`\`
`,
};
