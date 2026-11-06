---
name: "recipe-letter-reveal"
description: "Recipe for a letter-by-letter or word-by-word reveal: SplitText characters rising out of blur, staggered. Read when the motion log says letters appear one by one, a wordmark spells out or words pop in."
---
# Letter-by-letter reveal

A good reveal reads as one gesture across the word: each letter rises and sharpens in turn, with an even spread from first to last.

**Motion-log words:** letters appear one by one, letter reveal, type builds, characters fade/rise in, wordmark spells out, staggered letters, words pop in one after another.

## Rules
- For words instead of letters, split with `type: 'words'`.
- **Measure it:** bracket the reveal with readFrames fps 10, then refine each onset with adjacent frames. For N > 1 items, `each = (last onset - first onset) / (N - 1)`; the settle time also includes one letter's duration.
- **From the center:** `stagger: { each, from: 'center' }`.
- **Letters sliding up from a line:** `yPercent: 100` with the element at `overflow: hidden` (a mask under the baseline).
- **A wordmark revealing behind its logo:** `x: -40, opacity: 0` from the logo side.
- Animate only transforms, opacity and short blurs, within the blur budget in gsap page `revline`.

## Example
```ts
// built in root: <div class="reveal" style="font:500 96px/1 'Source Serif 4';white-space:pre">Launch day</div>
const { chars } = new SplitText(root.querySelector('.reveal'), { type: 'chars' });
tl.from(chars, {
  opacity: 0, yPercent: 60, filter: 'blur(10px)',
  duration: .35, ease: 'power3.out',
  stagger: { each: .035, from: 'start' },   // onset spread = each * (chars.length - 1)
}, at);
```
