---
name: "recipe-blur-in"
description: "Blur-in and motion blur: focus pulls, and fast moves smeared with blur plus a stretch along the direction of travel."
---
# Blur-in and motion blur

**Motion-log words:** blurs in, comes into focus, defocus, smeared, streaks in, whips in, flies in fast, motion blur, zooms past, snaps into place.

**Focus pull** (no movement): `tl.from(el, { filter: 'blur(24px)', opacity: 0, scale: 1.06, duration: .35, ease: 'power3.out' }, at)`.

**Motion blur on a fast move:** blur rises with speed and the element stretches along the direction of travel, both gone as it lands. A horizontal fly-in:
```ts
const d = .35;
gsap.set(el, { transformOrigin: '100% 50%' });   // stretch trails behind the leading edge
tl.from(el, { x: -900, duration: d, ease: 'power3.out' }, at)
  // stretch and blur peak at the start, where power3.out is fastest, and resolve as it settles
  .fromTo(el, { scaleX: 1.35, scaleY: .92, filter: 'blur(14px)' },
    { scaleX: 1, scaleY: 1, filter: 'blur(0px)', duration: d * .7, ease: 'power2.out' }, at);
```
- Vertical travel stretches `scaleY` instead. CSS blur is the same in every direction; for a true directional streak put an SVG `feGaussianBlur stdDeviation="14 0"` filter on the element (`filter: 'url(#mb)'`) and tween its stdDeviation attribute.
- For many elements moving together (keys flying into a row), stagger the whole recipe .04 to .08 s per element.
- Blur budget and exceptions: ≤8 elements for ≤0.5 s (revline); verify before/mid/settle with getFrames.