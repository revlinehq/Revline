---
name: "recipe-fly-off"
description: "Fly-off: an element leaving fast with a tilt and blur, often staggered, as an exit or hand-off."
---
# Fly-off with tilt and blur

**Motion-log words:** flies off, flies away, thrown out, tossed, swept off, exits fast, cards scatter, leaves with a spin, knocked out of frame.

```ts
tl.to(el.querySelectorAll('.item'), {
  x: (i: number) => 700 + i * 120, y: (i: number) => -260 - i * 40,
  rotation: (i: number) => 18 + i * 6,
  filter: 'blur(10px)', opacity: 0,
  duration: .28, ease: 'power2.in',
  stagger: { each: .05, from: 'end' },
}, at);
```
- **The tilt** leans into the direction of travel (moving right and up: positive rotation 10 to 25 degrees); set `transformOrigin` on the trailing edge for a toss.
- **Blur and fade** start late in the move: split them into a second tween at `at + .2` with `power2.in` if the reference keeps the element sharp at first.
- `from: 'end'` so the last item leaves first when they pile up.
- A fly-off that hands over to the next beat overlaps its entrance: start the next element's entrance before this exit ends.