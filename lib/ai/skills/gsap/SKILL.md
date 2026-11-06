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
- The motion helpers (`shot`, `push`, `hit`, `cursor`, `beat`) put their moves on the timeline you pass them; API reference: writing-scenes page `films`, Motion helpers.
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

## Text functions
The scene function receives `reveal`, `exit`, `swap`, `counter`, `type` and `mark` beside `tl` and `section`. Each builds its moves while the scene builds and returns its own timeline, placed at `at` (seconds, rounded to a whole frame) on the timeline being built: inside a `section(...)` build that section's, otherwise the scene's `tl`. Pass `tl` to place it elsewhere. `el` is an element already appended to the scene, or a selector inside `root`.

Units: distances are em of the element's font size (`'24px'` strings also work); `frames` and `stagger` are whole frames. Every value is clamped to its range; a property left out or set to `false` does not move. Defaults and ranges are stored as time and converted at the film's fps; the frame counts below are at 60 fps. Sources are launch films measured frame by frame (film and frames given).

They keep these mechanics: splits wait for the scene's fonts and keep the measured kerning, line breaks and layout, so nothing moves when text splits; ligatures are switched off for the element when a chars split would break one; staggers land on whole frames; blur ends at exactly 0 (the filter is removed); a revealed unit is hidden on every frame before its start; brand and scene fonts are inherited, never replaced.

### reveal(el, options)
`reveal(el, { split, from, stagger, frames, ease, at, feather })`
- `split`: `'chars' | 'words' | 'lines'`, default `'words'`.
- `from`: the state each unit starts in; combine any of these. `true` uses the default. Default `{ y: true }`.
  - `y`: default 0.8, range −1.2 to 1.2 (01-firecrawl f8–45: 67px rise on 83px text; 02-firecrawl f12–60: 138px on 115px). Positive starts below.
  - `x`: default 0.14, range −1.2 to 1.2 (02-firecrawl f282–296: 23px on 164px text).
  - `scale`: default 0.81, range 0.15 to 1.25 (01-firecrawl f317–367 grows 852→1046px; 10-deepusleepy f1228 hinge from 0.156; 01-firecrawl f303–316 pulse to 1.23×).
  - `blur`: default 0.17, range 0 to 0.2 (04-rerun f210–221: 8px on 48px letters; 01-firecrawl f1272–1290: 6px on 32px).
  - `opacity`: default 0, range 0 to 1 (01-firecrawl f376: first contrast ~0.07).
  - `clip`: the edge a soft wipe brings the unit in from (an exit wipes it out toward that edge), `'left' | 'right' | 'top' | 'bottom'`, default `'left'` (03-firecrawl f635–643, 01-firecrawl f641–680).
  - `rotate`: degrees, default 4, range −8 to 8. Not measured: all 26 studied patterns keep text upright.
- `feather`: soft edge of `clip`, default 1, range 0 to 1.5 (03-firecrawl wordmark: 90–105px on 66px; f12–20 shape uncover: hard edge).
- `stagger`: frames between units, range 0 to 17. Default chars 2 (01-firecrawl f465–563 prompt), words 8 (01-firecrawl onsets f8/16/24), lines 17 (02-firecrawl f12/29/46).
- `frames`: per unit, default 37, range 7 to 50 (01-firecrawl f8–45; 10-deepusleepy f1228–1235; 01-firecrawl f317–367). `ease` default `'expo.out'` (01-firecrawl f8–45).
- `at`: default 0.

A `lines` split moves each line as one piece: its words share the line's timing and turn about the line's centre. A revealed element is hidden from the scene's first frame until its reveal starts.

```ts
reveal(title, { split: 'words', from: { y: 0.6, blur: true }, stagger: 6, at: 0.4 });
```

### exit(el, options)
`exit(el, { split, to, stagger, frames, ease, at, feather })`: the same properties as `reveal`, as the state each unit ends in; units are hidden after their last frame. Another text may reveal under it at the same time.
- `to` default `{ y: true }`. Exit defaults: `y` −0.6 (01-firecrawl f114–136: 50px lift on 83px text), `blur` 0.19 (01-firecrawl f1272–1290: 0→6px on 32px), `opacity` 0 (same exit, contrast 0.99→0.04); other properties as `reveal`.
- `stagger` default 0 (01-firecrawl f114–136 lifts as one block), range 0 to 17. `frames` default 22, range 7 to 50 (01-firecrawl f114–136). `ease` default `'power1.in'` (01-firecrawl f114–136, f1273–1290).

```ts
exit(title, { to: { y: true, opacity: 0 }, at: 2.6 });
```

### swap(el, text, options)
`swap(el, text, { direction, frames, overlap, ease, at, width, clip, blur })`: replaces `el`'s text in place; the new text arrives while the old one leaves. Call it again on the same element to swap again. On an inline element the width follows the text; a block element keeps its own width.
- `direction`: `'up' | 'down' | 'left' | 'right' | 'flip'`, default `'up'` (10-deepusleepy f1767–1783 rolls up one slot). `'flip'` folds the old text flat and unfolds the new one (10-deepusleepy f1228–1235, incoming scaleY 0.156→1).
- `frames`: each text's move, default 16, range 7 to 24 (10-deepusleepy f1767–1783; f1228–1235; f1764–1788). `ease` default `'power4.out'` (10-deepusleepy f1767–1783).
- `overlap`: share of the old text's move during which the new one already moves, default 1, range 0 to 1 (10-deepusleepy: both lines travel together).
- `width`: `'animate'` (default) moves the element's width from the old text's to the new one's with the same ease, so the sentence around it slides instead of jumping; `'hold'` keeps the wider of the two from the start.
- `clip`: a fixed slot that hides the travelling text outside the element's box, default `true` (07-krea f822–831). `blur`: motion blur peak, default 0, range 0 to 0.22 (10-deepusleepy f1768: 38px on a 170px slot).

```ts
swap(word, 'Codex.', { direction: 'flip', frames: 8, at: 3.1 });
```

### counter(el, from, to, options)
`counter(el, from, to, { frames, ease, format, at, roll })`: writes the number for every frame. Digits sit in fixed-width cells (tabular figures, and each cell as wide as the widest digit), and the element keeps the widest value's width, so nothing jitters.
- `frames`: default 44, range 9 to 75 (02-firecrawl f208–252; 07-krea f822–831; 02-firecrawl f207–282). `ease` default `'sine.inOut'` (02-firecrawl f208–252).
- `format`: `{ prefix, suffix, decimals, separator }`, defaults `''`, `''`, 0 (range 0 to 6), `','` (02-firecrawl reads 400,000+), or a function from value to text.
- `roll`: `true` turns digit columns like an odometer: a column moves only while every column below it passes 9 (07-krea f822–831). Default `false`: digits are replaced (02-firecrawl f208–252).

```ts
counter(stat, 0, 400000, { format: { suffix: '+' }, at: 1.2 });
```

### type(el, text, options)
`type(el, text, { cps, caret, mistakes, seed, hold, blink, at })`: types `text` into `el` one character per step, every step on a frame boundary. The whole text is laid out first with untyped characters hidden, so words never jump lines while typing.
- `cps`: characters per second (each keystroke on the first frame at or after its time), default 30, range 10 to 60 (01-firecrawl f465–563: 49 characters in 98 frames).
- `caret`: `true` (default), `false`, or `{ color, width }`; color defaults to the text color, width 0.06 (range 0.02 to 0.2), height 0.9 em (01-firecrawl: 26–27px caret on the 30px strip). Its own caret element.
- `mistakes`: wrong letters typed and deleted, default 0, range 0 to 3. Positions and letters come from `seed` (default 1) and the text, so they are the same in preview and export.
- `hold`: frames the caret stays after the last character, default 37, range 0 to 120 (01-firecrawl f563–600). `blink`: frames per half cycle during the hold, default 0 (solid), range 0 to 60.

```ts
type(prompt, 'Find every SOC 2 vendor in our stack', { mistakes: 1, at: 0.5 });
```

### mark(el, options)
`mark(el, { style, frames, from, at, color, thickness, offset })`: sweeps a mark across the text's measured line boxes, line by line for wrapped text (each line's share of the frames follows its width; from `'center'` every line grows at once).
- `style`: `'underline' | 'highlight' | 'box'`, default `'underline'`.
- `from`: `'left' | 'right' | 'center'`, default `'left'` (06-rightnow f1302–1336 grows from its left end).
- `frames`: default 34, range 9 to 80 (06-rightnow f1302–1336, window f1300–1380). `ease` default `'power2.out'` (06-rightnow f1302–1336).
- `color`: default the text color; a highlight defaults to the text color at 22%, behind the text.
- `thickness` (underline and box): default 0.05, range 0.02 to 0.2; `offset` (underline below the line box): default 0.08, range −0.3 to 0.5 (06-rightnow: 3px rule 19px under the baseline of 62px text).

```ts
mark(claim, { style: 'highlight', color: brand.colors.accent, at: 1.8 });
```

## Pages
- `revline`: this page; read first.
- `gsap-timeline`: the position parameter (absolute, `<`, `>`, `-=0.2`), labels, timeline defaults and nesting. Sequence with these instead of chained delays.
- `gsap-core`: move vars, eases, stagger (each, amount, from, grid), function-based and relative values.
- `gsap-plugins`: SplitText (split once while building, animate lines, words or chars), ScrambleText, DrawSVG, MorphSVG, MotionPath, CustomEase, CustomWiggle and CustomBounce. Skip the scroll, drag, Flip, Inertia, Observer, physics, Pixi and GSDevTools sections.
- `gsap-performance`: transforms, batched reads and writes, bounded heavy effects.
- `gsap-utils`: clamp, mapRange, normalize, interpolate, snap, wrap, distribute, toArray and selector for computing values; random and shuffle only while building.
