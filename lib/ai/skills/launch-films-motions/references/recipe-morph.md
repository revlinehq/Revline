---
name: "recipe-morph"
description: "Recipe for a morph: one shape or UI state turning into another, with MorphSVG for shapes or a measured box change between two layouts. Read when the motion log says morphs into, turns into, grows into or a shared element carries over."
---
# Morph

A good morph keeps one continuous object: the eye never sees two things crossfading, and the new content appears only once the shape has nearly arrived.

**Motion-log words:** morphs into, turns into, becomes, transforms, the pill grows into a card, the button expands, the icon reshapes, shared element carried over, one shape to another.

## Rules
- **Shapes** (SVG paths): use MorphSVG; it matches the points.
- If a twist looks wrong, use `morphSVG: { shape: '#to', type: 'rotational' }`. Use `shapeIndex` to pick where the points line up.
- **UI states** (a pill growing into a card, a key becoming a button): one element whose box changes between the two layouts.
- The Flip plugin is not loaded: measure both states where the timeline is built and animate the difference.
- For a panel morph under 1 s, reveal its children in the final 40%, with the frame clipping them.

## Example
A shape:
```ts
// built in root: <svg ...><path id="from" d="…circle…" /><path id="to" d="…star…" style="visibility:hidden" /></svg>
tl.to(root.querySelector('#from'), { morphSVG: '#to', duration: .5, ease: 'power2.inOut' }, at);
```
A pill growing into a card:
```ts
// el is laid out in its final state; start it at the pill's size and place
tl.fromTo(el, { width: 220, height: 64, x: 180, y: 260, borderRadius: 32 },
  { width: 860, height: 300, x: 0, y: 0, borderRadius: 24, duration: .5, ease: 'power2.inOut' }, at)
  .from(el.children, { opacity: 0, y: 12, duration: .35, stagger: .05, ease: 'power3.out' }, at + .3);
```
