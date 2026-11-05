---
name: "recipe-morph"
description: "Morph: one shape or UI state turning into another, with MorphSVG or a manual FLIP between two layouts."
---
# Morph

**Motion-log words:** morphs into, turns into, becomes, transforms, the pill grows into a card, the button expands, the icon reshapes, shared element carried over, one shape to another.

**Shapes** (SVG paths): MorphSVG matches the points for you.
```tsx
const ref = useTimeline<SVGSVGElement>((tl, el) => {
  tl.to(el.querySelector('#from'), { morphSVG: '#to', duration: .6, ease: 'power3.inOut' }, at);
});
// <path id="from" d={circle} /> and <path id="to" d={star} style={{ visibility: 'hidden' }} />
```
Use `morphSVG: { shape: '#to', type: 'rotational' }` when a twist looks wrong, and `shapeIndex` to pick where the points line up.

**UI states** (a pill growing into a card, a key becoming a button): one element whose box tweens between the two layouts. The Flip plugin is not loaded; measure both states where the timeline is built and tween the difference:
```tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  // el is laid out in its final state; start it at the pill's size and place
  tl.fromTo(el, { width: 220, height: 64, x: 180, y: 260, borderRadius: 32 },
    { width: 860, height: 300, x: 0, y: 0, borderRadius: 24, duration: .7, ease: 'expo.inOut' }, at)
    .from(el.children, { opacity: 0, y: 12, duration: .3, stagger: .05, ease: 'power2.out' }, at + .45);
});
```
- For one <1 s panel morph, reveal children in the final 40%; keep the frame clipping them (revline).
- Across a beat cut inside a film the morph is one tween in the film timeline running through the cut; never two clips that each do half.
- **Timing:** .5 to .9 s; `expo.inOut` or `power3.inOut`. Contents in .2 to .35 s, staggered .04 to .06 s.