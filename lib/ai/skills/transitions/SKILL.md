---
name: "transitions"
description: "How one footage shot becomes the next (reels, vlogs, clips, gaming and sports montages, any edit of real footage): the hard cut (the default), whips with addTransition (left, right, up, down, zoom, zoom-out; 4–5 frames), fades, when to whip and how many on beat-synced montages. Read before adding any transition or whip to footage."
---
# Transitions

A good shot change is a hard cut, unless a chosen beat earns more. A whip is 4–5 frames: both shots stay composed where they are, the outgoing one flicks a short way in one direction with motion blur along that direction, and the incoming one arrives already moving the same way and settles. Nothing slides a full frame.

Films made from scratch whip with `whip()`: launch-films-motions page `shot-changes`.

Terms: the **cut** is the first frame of the incoming shot; `f` is one frame (1/30 s at 30 fps); **travel** is how far the picture moves, as a share of the frame's width (left/right) or height (up/down).

## Workflow
1. Pick the kind for each cut from Defaults. Start from a hard cut; whip only the cuts When to whip allows.
2. Add each whip or fade with addTransition across the cut (Settings).
3. Check every whip with getFrames as Check lists.

## Defaults
At 30 fps. The user's direction and a reference being copied win.

| Shot change | Frames | Seconds | Use for |
|---|---|---|---|
| Hard cut | 0 | 0 | Every cut by default |
| Whip (left, right, up, down, zoom, zoom-out) | 4–5 | 0.13–0.17 | A topic change, a chosen music hit, a montage beat |
| Crossfade | 9–18 | 0.3–0.6, aim 0.5 | A change of time or mood only |
| Fade to black | 9 | 0.3 | The end of the edit, or a jump in time (configureVisualFade) |

### Whip settings
| Whip | Travel | Outgoing shot | Incoming shot | Peak blur at 1080p |
|---|---|---|---|---|
| Left, right | 15% of width (10–25%) | flicks 15% toward that side, `power4.in` | arrives 15% from the other side, `expo.out` | 24 px, horizontal only |
| Up, down | 15% of height (10–25%) | flicks 15% toward that side, `power4.in` | arrives 15% from the other side, `expo.out` | 24 px, vertical only |
| Zoom | scale 1.25 | scales 1 → 1.25, `power4.in` | scales 1.12 → 1, `expo.out` | 10 px |
| Zoom-out | scale 0.8 | scales 1 → 0.8, `power4.in` | scales 0.88 → 1, `expo.out` | 10 px |

The direction is where the picture travels on screen: in a whip left, both shots move toward the left edge. The shot not in front fills the edge the moving one uncovers.

### Frame by frame (whip left, 4 frames, cut at T)
| Frame | In front | Offset | Blur |
|---|---|---|---|
| T − 3f | outgoing, at rest | 0 | 0 |
| T − 2f | outgoing | −0.9% | 1.5 px |
| T − f | outgoing, peak | −15% | 24 px |
| T | incoming, peak | +15% | 24 px |
| T + f | incoming | +0.5% | 0.8 px |
| T + 2f | incoming, at rest | 0 | 0 |

## Rules

### When to whip
- **Hard cut by default.** Whip only on a topic change or a music hit you chose. Check: at most one cut in three is a whip, and never two whips in a row.
- **Beat-synced montages** (gaming, sports, music edits whose cuts land on beats): up to every other cut may whip, still never two in a row. Example: 12 beat cuts, at most 6 whips, on the bigger hits.
- **Never whip:**
  - a calm, slow or emotional moment (hard cut, or a crossfade for a change of time or mood);
  - a jump cut inside one talking-head sentence (hard cut);
  - against the motion in the shots: a whip right after a shot that pans left;
  - when a reference uses a different transition at that cut (match the reference).
- Other presets (spin-zoom, film-burn, gradient-wipe, iris-wipe, blur-dissolve, zoom-through) only when the user asks for one or a reference uses one.

### Settings
addTransition is part of every footage lane (edits, reels, clips); film lanes use launch-films-motions page `shot-changes` instead.

| Whip | addTransition |
|---|---|
| Left, right, up, down | `preset: "whip-pan"`, `whipDirection: "left"` (or `right`, `up`, `down`) |
| Zoom | `preset: "whip-pan"`, `whipDirection: "zoom"` |
| Zoom-out | `preset: "whip-pan"`, `whipDirection: "zoom-out"` |
| All whips | `travel` 0.15 (0.1–0.25); `frames` 4 (default) or 5, 3 or 6 only to match a reference; `blur` 24 px (zooms 10), 0 for none |

- Whips center on the cut: 4 frames is 2 before it and 2 after; 5 frames starts half a frame early.
- whipDirection follows the motion in the shots: a shot panning right gets a whip right.
- zoom-through is a push, not a whip: the outgoing shot blows past 4× and the incoming one grows in from 0.35×.

## Check
- getFrames rounds a time down to its frame, so ask 0.5 ms after each frame: for a cut at 6 s, 5.9675 (T − f), 6.0005 (T) and 6.0675 (T + 2f).
- At T − f the outgoing shot is about 15% along the whip; at T the incoming one is about 15% behind, arriving the same way. Both are smeared along the whip axis only.
- At T + 2f the incoming shot is sharp and in place.
- Count the cuts: at most one in three is a whip (every other cut on a beat-synced montage), never two in a row.

## Example
A 40 s gaming montage cut on the music's beats, 12 cuts:
- 6 whips on the biggest hits, never two in a row: `addTransition { fromClipId, toClipId, preset: "whip-pan", whipDirection: "right" }`, the direction following the crosshair's motion; a zoom on the drop: `whipDirection: "zoom"`.
- The other 6 cuts stay hard cuts.
- getFrames 0.5 ms after T − f and T for each whip shows the short, axis-smeared flick; T + 2f is sharp.
