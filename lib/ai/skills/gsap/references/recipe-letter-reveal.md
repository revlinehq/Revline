---
name: "recipe-letter-reveal"
description: "Letter-by-letter or word-by-word reveal: SplitText chars rising out of blur, staggered."
---
# Letter-by-letter reveal

**Motion-log words:** letters appear one by one, letter reveal, type builds, characters fade/rise in, wordmark spells out, staggered letters, words pop in one after another.

```tsx
function Reveal({ text, at = 0 }: { text: string; at?: number }) {
  const ref = useTimeline<HTMLDivElement>((tl, el) => {
    const { chars } = new SplitText(el, { type: 'chars' });
    tl.from(chars, {
      opacity: 0, yPercent: 60, filter: 'blur(10px)',
      duration: .5, ease: 'expo.out',
      stagger: { each: .035, from: 'start' },   // onset spread = each * (chars.length - 1)
    }, at);
  });
  return <div ref={ref} style={{ font: '500 96px/1 "Source Serif 4"', whiteSpace: 'pre' }}>{text}</div>;
}
```

- **Timing:** each letter .35 to .6 s; stagger .02 to .05 s per letter (a 10-letter word spells out in about .3 to .5 s). Words instead of chars: `type: 'words'`, stagger .06 to .12 s.
- **Eases:** `expo.out` or `power3.out` (fast arrival, soft settle). `back.out(1.6)` for playful pops (use scale .6 to 1 with it).
- **Measure it:** bracket with readFrames fps 10, refine onset with adjacent frames. For N>1, `each=(last onset-first onset)/(N-1)`; settle also includes letter duration.
- **Variants:** from the center `from: 'center'`; letters sliding up from a line `yPercent: 100` with the element `overflow: hidden` (a mask under the baseline); a wordmark revealing behind its logo: `x: -40, opacity: 0` from the logo side.
- Only animate transforms, opacity and short blurs: blur on 30+ letters at 1080p is costly, keep it under .5 s.