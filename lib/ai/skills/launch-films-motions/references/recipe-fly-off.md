---
name: "recipe-fly-off"
description: "Recipe for a fly-off: elements leaving fast with a tilt and blur, often staggered, as an exit or hand-off. Read when the motion log says flies off, thrown out, tossed or scatters."
---
# Fly-off with tilt and blur

A good fly-off reads as one throw: the items lean into their direction of travel, leave last-first, and the next element is already entering.

**Motion-log words:** flies off, flies away, thrown out, tossed, swept off, exits fast, cards scatter, leaves with a spin, knocked out of frame.

## Rules
- **The tilt** leans into the direction of travel: moving right and up, positive rotation of 10 to 25 degrees.
- For a toss, set `transformOrigin` on the trailing edge.
- **Blur and fade start late in the move.** If the reference keeps the element sharp at first, split them into a second move at `at + .2` with `power2.in`.
- Use `from: 'end'` so the last item leaves first when items pile up.
- A fly-off that hands over to the next beat overlaps it: start the next element's entrance before this exit ends.

## Example
```ts
tl.to(el.querySelectorAll('.item'), {
  x: (i: number) => 700 + i * 120, y: (i: number) => -260 - i * 40,
  rotation: (i: number) => 18 + i * 6,
  filter: 'blur(10px)', opacity: 0,
  duration: .28, ease: 'power2.in',
  stagger: { each: .05, from: 'end' },
}, at);
```
