---
name: "gsap"
description: "Gives the engine rules for using GSAP inside Revline's frame-seeked scenes, plus GreenSock's official API pages (timeline, core, plugins, performance, utils). Read when writing GSAP code; it covers how GSAP works, while launch-films-motions decides how films look and move."
---
# GSAP in Revline scenes

GSAP choreographs scene motion: staggers, overlaps, word and letter reveals, SplitText, MorphSVG, DrawSVG, motion paths. A good scene puts every move on a supplied, paused timeline, so preview, scrubbing and export draw identical frames.

This page holds no style: durations, eases and looks are decided in launch-films-motions. The API pages adapt GreenSock's MIT skills (github.com/greensock/gsap-skills) for Revline; these rules win over them.

## Workflow
1. Build the DOM and set every starting state where elements are created.
2. Put each move on `tl` (or a section's timeline) with an explicit position.
3. Look up API details in the GreenSock pages (Pages).

## Rules

### The clock
- **Timelines are always paused and seeked to the frame**, for preview, scrubbing and export alike.
- Never play(), restart(), reverse(), change timeScale, or rely on a move playing in real time.
- **Every move goes on a supplied timeline:** the scene's `tl`, or the child timeline a `section(...)` callback receives (section-local seconds), always with a position parameter.
- Never use ScrollTrigger, ScrollSmoother, ScrollTo, Observer, Draggable, Inertia, Flip, GSDevTools, gsap.ticker, requestAnimationFrame, setTimeout or setInterval. None of them follow the frame clock.
- Never create a move outside a seeked timeline (a bare gsap.to, gsap.from or gsap.delayedCall).
- No responsive or reduced-motion branches: gsap.matchMedia does not apply, since the canvas has a fixed size and every frame is rendered.

### Starting states
- Starting states go where elements are built, so the first frame never flashes.
- `tl.from` and `tl.fromTo` apply their start state when the timeline is built. Keep immediateRender for the first entrance; later from/fromTo moves on the same property set it false.
- Anything else hidden at its first frame gets `gsap.set` (or inline style) right where it is created.
- Never `tl.set(el, {…}, 0)` for a starting state: a set at position 0 does not apply on the first frame drawn, so the part flashes for one frame.

### Properties and cost
- Animate transforms and opacity: x, y, xPercent, yPercent, scale, rotation and opacity or autoAlpha. Use transforms for movement. will-change is unnecessary.
- **Blur budget at 1080p:** blur at most 8 elements for at most 0.5 s at a time. Avoid full-frame blur except in measured copies.

### Callbacks, randomness, steps and loops
- **Callbacks only write derived values:** onUpdate may write a counter's text. Nothing may depend on how often or in which order callbacks fire, since seeking jumps.
- **Randomness is seeded:** Math.random, gsap.utils.random and shuffle give the same values in preview and export when called while the timeline is built. Never call them per frame or inside onUpdate.
- **Instant changes:** `tl.set` at an explicit time, or `ease: 'steps(n)'`.
- **Loops:** `repeat: -1` (with `yoyo: true` for back-and-forth) on a move inside the timeline.

### Plugins
- {{revline:0}} and EasePack are loaded and registered. Import them from `gsap/<Name>`; registering again is harmless. No other plugin loads.

## Example
```ts
const card = root.querySelector('.card');
gsap.set(card, { autoAlpha: 0 });                      // hidden from the first frame
tl.to(card, { autoAlpha: 1, y: 0, duration: .35, ease: 'power3.out' }, 1.2)
  .to(card, { autoAlpha: 0, duration: .28, ease: 'power2.in' }, 3.4);
```

## Pages
- `revline`: this page; read first.
- `gsap-timeline`: the position parameter (absolute, `<`, `>`, `-=0.2`), labels, timeline defaults and nesting. Sequence with these instead of chained delays.
- `gsap-core`: move vars, eases, stagger (each, amount, from, grid), function-based and relative values.
- `gsap-plugins`: SplitText (split once while building, animate lines, words or chars), ScrambleText, DrawSVG, MorphSVG, MotionPath, CustomEase, CustomWiggle and CustomBounce. Skip the scroll, drag, Flip, Inertia, Observer, physics, Pixi and GSDevTools sections.
- `gsap-performance`: transforms, batched reads and writes, bounded heavy effects.
- `gsap-utils`: clamp, mapRange, normalize, interpolate, snap, wrap, distribute, toArray and selector for computing values; random and shuffle only while building.
