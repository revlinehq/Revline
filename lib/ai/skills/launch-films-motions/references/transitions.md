---
name: "transitions"
description: "Maps motion-log words to the transition recipe pages (letter reveal, write-on, mask wipe, blur-in and motion blur, morph, typing, fly-off) for launch films and recreations. Read when naming or building a transition."
---
# Transition recipes

A good transition uses the right recipe's structure with the timing from SKILL.md "Timing and easing". When copying a reference, its measured timing and ease win.

## Workflow
1. Name each moment's transition type in the motion log, using the table below.
2. Build it with its recipe page.
3. When copying a reference, measure its timing and ease (readFrames fps 10, trackReference) and keep the recipe's structure.

## Defaults
| Motion-log words | Type | Page |
| --- | --- | --- |
| letters appear one by one, type builds, words pop in, wordmark spells out | letter reveal | `recipe-letter-reveal` |
| draws on, writes on, stroke traces, spiral draws, handwriting, underline, signature | write-on / draw-on | `recipe-write-on` |
| wipes in, revealed left to right, uncovered, curtain, iris, diagonal reveal | mask wipe | `recipe-mask-wipe` |
| blurs in, comes into focus, smeared, streaks in, whips in, flies in fast | blur-in / motion blur | `recipe-blur-in` |
| morphs into, turns into, grows into, expands into, shared element across a cut | morph | `recipe-morph` |
| types, typing, dictation, text streams in, cursor, colored newest letters | typing | `recipe-typing` |
| flies off, thrown out, tossed, swept away, scatters, exits fast with a spin | fly-off | `recipe-fly-off` |

## Rules
- In every recipe, `el` is an element already built in `root`, `tl` is the film's timeline or the timeline a `section(...)` receives, and `at` is the position in that timeline's seconds (section-local inside a section).
- A moment can combine types (keys flying in with motion blur, then a morph into a pill): build each part with its recipe on the same timeline, overlapping as the reference does.
- A move that only slides, scales or fades needs no recipe: a `tl.from` with the ease from "Timing and easing", or the reference's measured ease when copying.

## Example
```ts
// keys and pill are built in root
section('Keys', 6, 3, (s) => {
  s.from(keys, { x: -900, filter: 'blur(14px)', duration: .35, ease: 'power3.out', stagger: .05 }, .2)   // blur-in
   .to(keys, { opacity: 0, duration: .2, ease: 'power2.in' }, 1.1)
   .from(pill, { scale: .6, opacity: 0, duration: .35, ease: 'power3.out' }, 1.1);                     // hand-off to the pill
});
```
