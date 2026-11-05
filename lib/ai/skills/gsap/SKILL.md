---
name: "gsap"
description: "GSAP choreography for scenes: GreenSock's official skills (timeline, core, plugins, React, performance, utils) under Revline's rules for paused, frame-seeked timelines. Read before writing staggers, word reveals, SplitText, MorphSVG or any multi-step motion in a scene."
---
# GSAP in Revline scenes

This skill is the GSAP API and the engine rules only. How Revline films should move (timing, eases, transitions, style) lives in motion-design.

GSAP choreographs scene motion: staggers, overlaps, word and letter reveals, SplitText, MorphSVG, DrawSVG, motion paths. The API pages adapt GreenSock’s MIT skills (github.com/greensock/gsap-skills) for Revline. Use the supplied paused timeline: the engine seeks every frame for identical preview/export.

## Rules
Build motion once; verify first/mid/settled frames and backward seeks with getFrames (scene-engine/checklist).
- **Timelines are always paused and seeked to the frame.** The engine seeks each scene's timeline to the frame being drawn, for preview, scrubbing and export alike. Never play(), restart(), reverse(), change timeScale, or rely on a tween playing in real time.
- **React scenes:** build every timeline with `useTimeline((tl, el) => { … })` (scene-engine page `react-scenes`). It is Revline's useGSAP: it scopes selector strings to the component's element, reverts everything on unmount, and seeks to the beat's local time. Do not import @gsap/react or call useGSAP, gsap.context, useEffect or useLayoutEffect for animation.
- **GSAP scenes:** put everything on the scene's `tl` with a position parameter.
- **Never** ScrollTrigger, ScrollSmoother, ScrollTo, Observer, Draggable, Inertia, Flip, GSDevTools, gsap.ticker, requestAnimationFrame, setTimeout or setInterval, and never a tween outside a seeked timeline (a bare gsap.to, gsap.from or gsap.delayedCall). None of them follow the frame clock, so preview, scrubbing and export would disagree.
- **Starting states go where elements are built**, so the first frame never flashes: `tl.from` and `tl.fromTo` apply their start state when the timeline is built (keep immediateRender for the first entrance; later from/fromTo tweens on the same property set it false), and anything else hidden at its first frame gets `gsap.set` (or inline style) right where it is created. Never `tl.set(el, {…}, 0)` for a starting state: a set at position 0 does not apply on the first frame drawn, so the part shows for one frame (a flash).
- **Animate transforms and opacity**: x, y, xPercent, yPercent, scale, rotation and opacity or autoAlpha. Use transforms for movement. One bordered panel may tween width/height or clip-path for <1 s to preserve type/borders; inspect mid-move edges. At 1080p, start blur on ≤8 elements for ≤0.5 s; avoid full-frame blur except measured copies. will-change is unnecessary.
- **Callbacks only write derived values.** onUpdate may write a counter's text; nothing may depend on how often or in which order callbacks fire, since seeking jumps.
- **Randomness is seeded.** Math.random, gsap.utils.random and shuffle give the same values in preview and export when called while the timeline is built; never call them per frame or inside onUpdate.
- **No responsive or reduced-motion branches.** gsap.matchMedia does not apply: the canvas has a fixed size and every frame is rendered.
- **Plugins:** {{revline:0}} and EasePack are loaded and registered; import them from `gsap/<Name>` (registering again is harmless). No other plugin loads.

## What to take from GreenSock's pages
- `gsap-timeline`: the position parameter (absolute, `<`, `>`, `-=0.2`), labels, timeline defaults and nesting. Sequence with these instead of chained delays.
- `gsap-core`: tween vars, eases, stagger (each, amount, from, grid), function-based and relative values.
- `gsap-plugins`: SplitText (split once while building, animate lines, words or chars), ScrambleText, DrawSVG, MorphSVG, MotionPath, CustomEase, CustomWiggle and CustomBounce. Skip the scroll, drag, Flip, Inertia, Observer, physics, Pixi and GSDevTools sections.
- `gsap-react`: the reasons behind scoping and cleanup, which useTimeline already does; skip installation, useGSAP itself, context-safe event handlers and SSR.
- `gsap-performance`: transforms, batched reads/writes and bounded heavy effects.
- `gsap-utils`: clamp, mapRange, normalize, interpolate, snap, wrap, distribute, toArray and selector for computing values; random and shuffle only while building.