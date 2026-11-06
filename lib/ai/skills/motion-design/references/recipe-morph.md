---
name: "recipe-morph"
description: "Morph: one shape or UI state turning into another, with MorphSVG or a manual FLIP between two layouts."
---
# Morph

**Motion-log words:** morphs into, turns into, becomes, transforms, the pill grows into a card, the button expands, the icon reshapes, shared element carried over, one shape to another.

**Shapes** (SVG paths): MorphSVG matches the points for you.
```ts
// built in root: <svg ...><path id="from" d="…circle…" /><path id="to" d="…star…" style="visibility:hidden" /></svg>
tl.to(root.querySelector('#from'), { morphSVG: '#to', duration: .5, ease: 'power2.inOut' }, at);
```
Use `morphSVG: { shape: '#to', type: 'rotational' }` when a twist looks wrong, and `shapeIndex` to pick where the points line up.

**UI states** (a pill growing into a card, a key becoming a button): one element whose box tweens between the two layouts. The Flip plugin is not loaded; measure both states where the timeline is built and tween the difference:
```ts
// el is laid out in its final state; start it at the pill's size and place
tl.fromTo(el, { width: 220, height: 64, x: 180, y: 260, borderRadius: 32 },
  { width: 860, height: 300, x: 0, y: 0, borderRadius: 24, duration: .5, ease: 'power2.inOut' }, at)
  .from(el.children, { opacity: 0, y: 12, duration: .35, stagger: .05, ease: 'power3.out' }, at + .3);
```
- For one <1 s panel morph, reveal children in the final 40%; keep the frame clipping them (revline).
- Across a section boundary inside a film the morph is one tween on the film's outer `tl` running through the boundary; never two sections or clips that each do half.