---
name: "recipe-write-on"
description: "Recipe for write-on and draw-on: strokes, spirals, underlines and signatures drawn with DrawSVG, and handwritten type written letter by letter. Read when the motion log says draws on, writes on, handwriting or underline."
---
# Write-on and draw-on

A good write-on follows the pen: the stroke grows from its start point in its drawing direction, at a steady speed, with no jump at either end.

**Motion-log words:** draws on, writes on, stroke draws, line traces, spiral draws in, signature, handwriting appears, underline draws, scribble, circle drawn around.

## Rules
- **A stroke** is an SVG path with `fill="none"` and a stroke: a spiral, underline, arrow, or a traced shape from traceShape. Draw it with DrawSVG.
- Without DrawSVG: `const len = path.getTotalLength(); gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })` where the path is built, then `tl.to(path, { strokeDashoffset: 0, … }, at)`.
- A path's direction is its draw direction. To draw from the other end, animate `drawSVG: '100% 100%'` to `'0% 100%'` instead of editing the path.
- **Handwritten type in a font** (the words "Voice typing" in a marker font): wipe each letter open in the writing direction, one after another, at pen speed.
- Handwriting keeps `ease: 'none'` per letter: a pen moves steadily.
- The colored newest letters some films show while writing are the typing recipe's highlight, layered on these letters.

## Example
A stroke:
```ts
// built in root: <svg class="spiral" viewBox="0 0 200 200" width="320"><path d="…" fill="none" stroke="#111" stroke-width="14" stroke-linecap="round" /></svg>
tl.fromTo(root.querySelector('.spiral path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: .5, ease: 'power2.inOut' }, at);
```
Handwritten type:
```ts
const { chars } = new SplitText(el, { type: 'chars' });
tl.fromTo(chars, { clipPath: 'inset(-20% 100% -20% 0)' },
  { clipPath: 'inset(-20% 0% -20% 0)', duration: .14, ease: 'none', stagger: .09 }, at);
```
