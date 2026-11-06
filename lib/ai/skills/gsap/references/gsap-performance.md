---
name: "gsap-performance"
description: "Official GSAP skill for performance — prefer transforms, avoid layout thrashing, will-change, batching. Use when optimizing GSAP animations, reducing jank, or when the user asks about animation performance, FPS, or smooth 60fps."
---
# GSAP Performance

Revline: add tweens to the supplied paused `tl` (or a section's timeline); the engine seeks it.


## Prefer Transform and Opacity

Animating **transform** (`x`, `y`, `scaleX`, `scaleY`, `rotation`, `rotationX`, `rotationY`, `skewX`, `skewY`) and **opacity** keeps work on the compositor and avoids layout and most paint. Avoid animating layout-heavy properties when a transform can achieve the same effect.

- ✅ Prefer: **x**, **y**, **scale**, **rotation**, **opacity**.
- For movement use transforms.

GSAP’s **x** and **y** use transforms (translate) by default; use them instead of **left**/**top** for movement.

## Batch Reads and Writes

GSAP batches updates internally. When mixing GSAP with direct DOM reads/writes or layout-dependent code, avoid interleaving reads and writes in a way that causes repeated layout thrashing. Prefer doing all reads first, then all writes (or let GSAP handle the writes in one go).

## Many Elements (Stagger, Lists)

- Use **stagger** instead of many separate tweens with manual delays when the animation is the same; it’s more efficient.
- For long lists, render only visible items; avoid creating hundreds of simultaneous tweens if it causes jank.
- Build each timeline once per mount, never per frame.

## Reduce Simultaneous Work

- Unmount or display:none hidden scene parts; opacity:0 alone still renders them.
- Start heavy blur on ≤8 elements for ≤0.5 s (revline).
