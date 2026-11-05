---
name: "recipe-blur-in"
description: "Blur-in and motion blur: focus pulls, and fast moves smeared with blur plus a stretch along the direction of travel."
---
# Blur-in and motion blur

**Motion-log words:** blurs in, comes into focus, defocus, smeared, streaks in, whips in, flies in fast, motion blur, zooms past, snaps into place.

**Focus pull** (no movement): `tl.from(el, { filter: 'blur(24px)', opacity: 0, scale: 1.06, duration: .6, ease: 'power3.out' }, at)`.

**Motion blur on a fast move:** blur rises with speed and the element stretches along the direction of travel, both gone as it lands. A horizontal fly-in:
```tsx
const ref = useTimeline<HTMLDivElement>((tl, el) => {
  const d = .45;
  tl.from(el, { x: -900, duration: d, ease: 'expo.out' }, at)
    // stretch and blur peak at the start, where expo.out is fastest, and resolve as it settles
    .fromTo(el, { scaleX: 1.35, scaleY: .92, filter: 'blur(14px)' },
      { scaleX: 1, scaleY: 1, filter: 'blur(0px)', duration: d * .7, ease: 'power2.out' }, at);
  gsap.set(el, { transformOrigin: '100% 50%' });   // stretch trails behind the leading edge
});
```
- Vertical travel stretches `scaleY` instead. CSS blur is the same in every direction; for a true directional streak put an SVG `feGaussianBlur stdDeviation="14 0"` filter on the element (`filter: 'url(#mb)'`) and tween its stdDeviation attribute.
- For many elements moving together (keys flying into a row), stagger the whole recipe .04 to .08 s per element.
- **Timing:** a fly-in .3 to .6 s, blur 8 to 20 px at the peak; a focus pull .4 to .8 s. Eases: `expo.out` for the move, `power2.out` for the blur and stretch so they clear before the move ends.
- Blur budget and exceptions: ≤8 elements for ≤0.5 s (revline); verify before/mid/settle with getFrames.