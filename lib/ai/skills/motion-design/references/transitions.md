---
name: "transitions"
description: "Transition recipes for launch films and remakes: which motion-log words map to which recipe page (letter reveal, write-on, mask wipe, blur-in and motion blur, morph, typing, fly-off)."
---
# Transition recipes

Name each moment's transition type in the motion log, then build it with its recipe. Every recipe is plain timeline code with its usual durations and eases: `el` is an element already built in `root`, `tl` is the scene's timeline or the timeline a film `section(...)` receives, and `at` is the position in that timeline's seconds (section-local inside a section); take the exact timing and ease from the reference (readFrames fps 10, trackReference) and keep the recipe's structure.

| Motion-log words | Type | Page |
| --- | --- | --- |
| letters appear one by one, type builds, words pop in, wordmark spells out | letter reveal | `recipe-letter-reveal` |
| draws on, writes on, stroke traces, spiral draws, handwriting, underline, signature | write-on / draw-on | `recipe-write-on` |
| wipes in, revealed left to right, uncovered, curtain, iris, diagonal reveal | mask wipe | `recipe-mask-wipe` |
| blurs in, comes into focus, smeared, streaks in, whips in, flies in fast | blur-in / motion blur | `recipe-blur-in` |
| morphs into, turns into, grows into, expands into, shared element across a cut | morph | `recipe-morph` |
| types, typing, dictation, text streams in, cursor, colored newest letters | typing | `recipe-typing` |
| flies off, thrown out, tossed, swept away, scatters, exits fast with a spin | fly-off | `recipe-fly-off` |

A moment can combine types (keys flying in with motion blur, then a morph into a pill): build each part with its recipe on the same timeline, overlapping as the reference does. Moves that only slide, scale or fade need no recipe: a `tl.from` with the measured ease.