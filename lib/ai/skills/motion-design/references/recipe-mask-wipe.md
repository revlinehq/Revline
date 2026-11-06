---
name: "recipe-mask-wipe"
description: "Mask wipe: clip-path inset or polygon reveals and hides, straight or diagonal, element or whole frame."
---
# Mask wipe

**Motion-log words:** wipes in, wipe, reveals left to right, uncovered, slides out from behind, curtain, diagonal wipe, panel opens, card unmasks, iris, split reveal.

```ts
const CLOSED = { left: 'inset(0% 100% 0% 0%)', right: 'inset(0% 0% 0% 100%)', top: 'inset(0% 0% 100% 0%)', bottom: 'inset(100% 0% 0% 0%)' };
tl.fromTo(el, { clipPath: CLOSED.left }, { clipPath: 'inset(0% 0% 0% 0%)', duration: .35, ease: 'power3.out' }, at);
```
- **Diagonal:** tween polygons with the same number of points: `'polygon(0% 0%, 0% 0%, 0% 100%, 0% 100%)'` to `'polygon(0% 0%, 120% 0%, 100% 100%, -20% 100%)'`.
- **Rounded or circular:** `inset(… round 24px)` keeps a card's corners; an iris is `circle(0% at 50% 50%)` to `circle(75% at 50% 50%)`.
- **Wipe out:** the same values reversed at the exit time (`tl.to(el, { clipPath: closedOtherSide }, out)`), usually leaving on the opposite side it came in.
- A wipe that carries content (text sliding with the mask edge): add `x: -40` to `0` on the child with the same duration and ease.
- Number formats must match on both ends (all % or all px), or GSAP cannot interpolate the clip path.