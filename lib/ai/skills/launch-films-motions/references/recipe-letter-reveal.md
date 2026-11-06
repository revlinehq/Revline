---
name: "recipe-letter-reveal"
description: "Letter-by-letter or word-by-word reveal: SplitText chars rising out of blur, staggered."
---
# Letter-by-letter reveal

**Motion-log words:** letters appear one by one, letter reveal, type builds, characters fade/rise in, wordmark spells out, staggered letters, words pop in one after another.

```ts
// built in root: <div class="reveal" style="font:500 96px/1 'Source Serif 4';white-space:pre">Launch day</div>
const { chars } = new SplitText(root.querySelector('.reveal'), { type: 'chars' });
tl.from(chars, {
  opacity: 0, yPercent: 60, filter: 'blur(10px)',
  duration: .35, ease: 'power3.out',
  stagger: { each: .035, from: 'start' },   // onset spread = each * (chars.length - 1)
}, at);
```

- Words instead of chars: `type: 'words'`.
- **Measure it:** bracket with readFrames fps 10, refine onset with adjacent frames. For N>1, `each=(last onset-first onset)/(N-1)`; settle also includes letter duration.
- **Variants:** from the center `from: 'center'`; letters sliding up from a line `yPercent: 100` with the element `overflow: hidden` (a mask under the baseline); a wordmark revealing behind its logo: `x: -40, opacity: 0` from the logo side.
- Only animate transforms, opacity and short blurs: blur on 30+ letters at 1080p is costly, keep it under .5 s.