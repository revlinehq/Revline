---
name: "recipe-write-on"
description: "Write-on and draw-on: strokes, spirals, underlines and signatures drawn with DrawSVG; handwritten type written letter by letter."
---
# Write-on and draw-on

**Motion-log words:** draws on, writes on, stroke draws, line traces, spiral draws in, signature, handwriting appears, underline draws, scribble, circle drawn around.

**A stroke** (an SVG path with `fill="none"` and a stroke: a spiral, underline, arrow, a traced shape from traceShape):
```tsx
function Spiral({ d, at = 0 }: { d: string; at?: number }) {
  const ref = useTimeline<SVGSVGElement>((tl, el) => {
    tl.fromTo(el.querySelector('path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: .8, ease: 'power2.inOut' }, at);
  });
  return <svg ref={ref} viewBox="0 0 200 200" width={320}><path d={d} fill="none" stroke="#111" strokeWidth={14} strokeLinecap="round" /></svg>;
}
```
Without DrawSVG: `const len = path.getTotalLength(); gsap.set(path, { strokeDasharray: len, strokeDashoffset: len })` where the path is built, then `tl.to(path, { strokeDashoffset: 0, … }, at)`. Draw from the other end with `drawSVG: '100% 100%'` to `'0% 100%'`.

**Handwritten type in a font** (VOICE TYPING in a marker font): wipe each letter open in the writing direction, one after another, at pen speed:
```tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  const { chars } = new SplitText(el, { type: 'chars' });
  tl.fromTo(chars, { clipPath: 'inset(-20% 100% -20% 0)' },
    { clipPath: 'inset(-20% 0% -20% 0)', duration: .14, ease: 'none', stagger: .09 }, at);
});
```
- **Timing:** a stroke .5 to 1.2 s; a word written by hand .08 to .12 s per letter, each letter .1 to .18 s with `ease: 'none'` (a pen moves steadily). A spiral or circle `power2.inOut`; an underline `power3.out` .4 to .6 s.
- The colored newest letters some films show while writing are the typing recipe's highlight (page `recipe-typing`) layered on these chars.
- A path's direction is its draw direction: if it draws backwards, reverse the drawSVG values instead of editing the path.