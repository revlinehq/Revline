import type { EditorSkill, EditorSkillPage } from '../index';
import { SCENE_GSAP_PLUGINS } from '../../../editor/scene-modules';
import { GREENSOCK_PAGES } from './pages';

/** Revline's rules for GSAP in scenes. They come first and win over anything in GreenSock's pages. */
const RULES = `# GSAP in Revline scenes

GSAP choreographs scene motion: staggers, overlaps, word and letter reveals, SplitText, MorphSVG, DrawSVG, motion paths. The pages after this one are GreenSock's official skills, unchanged (MIT, github.com/greensock/gsap-skills). Read them for the API and its best practices. Where they disagree with this page, this page wins: Revline renders every frame by seeking, never by playing.

## Rules
- **Timelines are always paused and seeked to the frame.** The engine seeks each scene's timeline to the frame being drawn, for preview, scrubbing and export alike. Never play(), restart(), reverse(), change timeScale, or rely on a tween playing in real time.
- **React scenes:** build every timeline with \`useTimeline((tl, el) => { … })\` (scene-engine page \`react-scenes\`). It is Revline's useGSAP: it scopes selector strings to the component's element, reverts everything on unmount, and seeks to the beat's local time. Do not import @gsap/react or call useGSAP, gsap.context, useEffect or useLayoutEffect for animation.
- **GSAP scenes:** put everything on the scene's \`tl\` with a position parameter.
- **Never** ScrollTrigger, ScrollSmoother, ScrollTo, Observer, Draggable, Inertia, Flip, GSDevTools, gsap.ticker, requestAnimationFrame, setTimeout or setInterval, and never a tween outside a seeked timeline (a bare gsap.to, gsap.from or gsap.delayedCall). None of them follow the frame clock, so preview, scrubbing and export would disagree.
- **Starting states go where elements are built**, so the first frame never flashes: \`tl.from\` and \`tl.fromTo\` apply their start state when the timeline is built (keep immediateRender at its default), and anything else hidden at its first frame gets \`gsap.set\` (or inline style) right where it is created. Never \`tl.set(el, {…}, 0)\` for a starting state: a set at position 0 does not apply on the first frame drawn, so the part shows for one frame (a flash).
- **Animate transforms and opacity**: x, y, xPercent, yPercent, scale, rotation and opacity or autoAlpha. Avoid width, height, top, left, margin or padding tweens; they relayout every frame. Blur filters and big box-shadows are expensive at 1080p, so keep them short and on few elements. will-change is unnecessary.
- **Callbacks only write derived values.** onUpdate may write a counter's text; nothing may depend on how often or in which order callbacks fire, since seeking jumps.
- **Randomness is seeded.** Math.random, gsap.utils.random and shuffle give the same values in preview and export when called while the timeline is built; never call them per frame or inside onUpdate.
- **No responsive or reduced-motion branches.** gsap.matchMedia does not apply: the canvas has a fixed size and every frame is rendered.
- **Plugins:** ${SCENE_GSAP_PLUGINS.join(', ')} and EasePack are loaded and registered; import them from \`gsap/<Name>\` (registering again is harmless). No other plugin loads.

## What to take from GreenSock's pages
- \`gsap-timeline\`: the position parameter (absolute, \`<\`, \`>\`, \`-=0.2\`), labels, timeline defaults and nesting. Sequence with these instead of chained delays.
- \`gsap-core\`: tween vars, eases, stagger (each, amount, from, grid), function-based and relative values.
- \`gsap-plugins\`: SplitText (split once while building, animate lines, words or chars), ScrambleText, DrawSVG, MorphSVG, MotionPath, CustomEase, CustomWiggle and CustomBounce. Skip the scroll, drag, Flip, Inertia, Observer, physics, Pixi and GSDevTools sections.
- \`gsap-react\`: the reasons behind scoping and cleanup, which useTimeline already does; skip installation, useGSAP itself, context-safe event handlers and SSR.
- \`gsap-performance\`: transform and opacity, few simultaneous heavy effects; skip the ScrollTrigger and mouse-follower parts.
- \`gsap-utils\`: clamp, mapRange, normalize, interpolate, snap, wrap, distribute, toArray and selector for computing values; random and shuffle only while building.`;

const rulesPage: EditorSkillPage = { name: 'revline', description: 'Read first: how GSAP works in Revline scenes (paused, seeked timelines; useTimeline; what never to use). Wins over the GreenSock pages.', body: RULES };

export const gsapSkill: EditorSkill = {
  name: 'gsap',
  description: 'GSAP choreography for scenes: GreenSock\'s official skills (timeline, core, plugins, React, performance, utils) under Revline\'s rules for paused, frame-seeked timelines. Read before writing staggers, word reveals, SplitText, MorphSVG or any multi-step motion in a scene.',
  body: RULES,
  pages: [rulesPage, ...GREENSOCK_PAGES],
};
