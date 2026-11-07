---
name: "shot-changes"
description: "How a film changes shots: hard cut by default, the whip() helper (left, right, up, down, zoom, zoom-out; 4–5 frames), arrivals that carry in and overlap the exit before them, and the frame checks. Read before any cut, whip or arrival between sections of a film."
---
# Shot changes in films

A good shot change in a film is a hard cut, unless a chosen beat earns a whip. A whip is 4–5 frames: the shots flick a short way in one direction with motion blur while both stay composed where they belong. Nothing slides in from off-screen, and every arrival is already moving when it appears.

Terms: the **cut** is the first frame of the incoming shot; `f` is one frame (1/30 s at 30 fps); **travel** is how far the shot moves, as a share of the frame's width (left/right) or height (up/down).

Footage (reels, clips, montages) changes shots with addTransition in the `transitions` skill, not with this page.

## Workflow
1. Pick each shot change: a hard cut, or a whip where When to whip allows.
2. Compose both shots at rest first (Rules, Composition).
3. Call `whip()` for each whip (Film code). Never hand-write a whip: `whip()` and the footage whip-pan share one motion.
4. Time every arrival by Rules (Carry and overlap), whip or not.
5. Check with getFrames as Check lists.

## Defaults
At 30 fps. A reference being copied and the user's direction win.

| Shot change | Frames | Seconds | Use for |
|---|---|---|---|
| Hard cut | 0 | 0 | Every shot change by default |
| Whip (left, right, up, down, zoom, zoom-out) | 4–5 | 0.13–0.17 | A topic change or a chosen music hit |
| Fade through black | 9 out + 9 in | 0.3 + 0.3 | The film's end only |

### Whip settings
| Whip | Travel | Outgoing shot (2 frames) | Incoming shot (2 frames) | Peak blur at 1080p |
|---|---|---|---|---|
| Left | 15% of width (10–25%) | x 0 → −15%, `power4.in` | x +15% → 0, `expo.out` | 24 px, horizontal only |
| Right | 15% of width (10–25%) | x 0 → +15%, `power4.in` | x −15% → 0, `expo.out` | 24 px, horizontal only |
| Up | 15% of height (10–25%) | y 0 → −15%, `power4.in` | y +15% → 0, `expo.out` | 24 px, vertical only |
| Down | 15% of height (10–25%) | y 0 → +15%, `power4.in` | y −15% → 0, `expo.out` | 24 px, vertical only |
| Zoom (in) | scale 1.25 | scale 1 → 1.25, `power4.in` | scale 1.12 → 1, `expo.out` | 10 px |
| Zoom out | scale 0.8 | scale 1 → 0.8, `power4.in` | scale 0.88 → 1, `expo.out` | 10 px |

The direction is where the picture travels on screen: in a whip left, both shots move toward the left edge.

### Frame by frame (whip left, cut at T)
| Frame | Shown | Frame offset | Blur |
|---|---|---|---|
| T − 3f | outgoing, at rest | 0 | 0 |
| T − 2f | outgoing | −0.9% | 1.5 px |
| T − f | outgoing, peak | −15% | 24 px |
| T | incoming, peak | +15% | 24 px |
| T + f | incoming | +0.5% | 0.8 px |
| T + 2f | incoming, at rest | 0 | 0 |

## Rules

### When to whip
- Whip only on a topic change or a music hit you chose. Check: at most one shot change in three is a whip, and never two in a row.
- Never whip while a camera move is still running through the cut, or against the motion in the shots.

### Composition
- **Never park a part off-center so it can slide.** Wrong: the product card sits at `left:70%` and slides to the center as the whip. Right: the card sits centered in both shots and `whip()` flicks the whole shot.
- **Whip whole shots, not single parts:** `out` and `in` are the shot containers (the full-frame layer each section shows), not one card inside them.
- **No empty edge:** the background sits on the stage, outside the shots, so the travel shows background, not a gap. A shot with its own full-frame background puts it on a layer with `inset:-25%`.
- **The whip is the exit and the entrance:** the outgoing shot runs no exit move in its last 3 frames, and the incoming shot runs no entrance in its first 2.
- **One frame clock:** the incoming shot arrives already moving in the whip's direction and settles; it never stops at the cut and starts again.

### Carry and overlap
Applies to every arrival after a hard cut or an exit, not only whips.
- **Overlap:** the incoming shot's entrance starts 2–4 frames (0.07–0.13 s) before the outgoing shot has fully left. Wrong: the title's exit ends at 2.58 s and the card's entrance starts at 2.7 s, leaving a frame with nothing moving. Right: the card starts at 2.5 s.
- **Arrive moving:** the first frame the incoming part is visible, it is already offset and moving, never parked at its start position for a frame.
- **Land fast-start, slow-end:** `expo.out` or `power4.out`, 0.35–0.5 s. Never an inOut ease, which starts slow and reads as a predictable zoom in, zoom out.
- **A hold after the landing is fine:** once the arrival has settled, the shot may rest for its beat. The rule is only that the arrival itself is not a dead stop or a frozen frame.
- Overlapping moves span two sections, so they go on the outer `tl` (Film code, Carry and overlap).

## Film code

### whip()
Scene code receives `whip` next to `section`. It runs the recipe in Defaults: the outgoing shot accelerates out (`power4.in`), the incoming one arrives already moving the same way and settles (`expo.out`), and the blur along the axis peaks at the cut and is 0 on the last frame. Shots stay where they are composed. The motion is the same as the footage whip-pan's, frame for frame.

`whip(tl, { out, in, at, direction, frames, travel, blur, fill })`

| Option | Values | Default |
|---|---|---|
| `tl` | the scene's `tl` (at in film seconds) or the `tl` a section receives (at in section seconds) | |
| `out`, `in` | an element, a selector inside root, or a list | |
| `at` | the cut: the first frame of `in` | |
| `direction` | `left`, `right`, `up`, `down`, `zoom`, `zoom-out` | `left` |
| `frames` | 4 or 5 (Defaults), counted at 30 fps; 3 or 6 only to match a reference | 4 |
| `travel` | 0.1–0.25 of the frame (zoom: 0.15 scales to 1.25) | 0.15 |
| `blur` | `true`, `false`, or peak px at 1080p (0–48) | `true`: 24 px, zooms 10 px |
| `fill` | `true` keeps the other shot visible underneath, filling the edge the front one uncovers, as footage does; only for opaque full-frame shots | `false` |

- Hide `in` in its markup (`visibility:hidden`); whip() shows it at the cut (with `fill`, from the whip's first frame), hides `out` from the cut (with `fill`, after the last frame), and leaves both at rest after the whip, so a later cut back shows them in place.
- The whip must fit in the film: a few frames before the cut, and its incoming frames before the film ends.
- Called inside a section, the whip may run past that section's end: it goes on the film's timeline.
- Shots are `position:absolute` layers in a positioned parent (the stage). Hide a shot with visibility or opacity, never `display:none`.
- It wraps each shot once in a full-size layer (`[data-whip-layer]`) and moves and blurs only that layer, so the shots' own GSAP moves and filters keep working. Select shots by class, not `.stage > .shot`.

```js
export default function scene({ root, section, whip }) {
  root.innerHTML = `
    <div class="stage" style="position:absolute;inset:0;overflow:hidden;background:#141413;color:#F4F4F0">
      <div class="hook" style="position:absolute;inset:0;display:grid;place-items:center;font:600 120px Inter">Cut the pauses</div>
      <div class="product" style="position:absolute;inset:0;display:grid;place-items:center;visibility:hidden">
        <div style="width:960px;height:540px;border-radius:32px;background:#2a2a2a"></div>
      </div>
      <div class="end" style="position:absolute;inset:0;display:grid;place-items:center;font:700 140px Inter;visibility:hidden">Revline</div>
    </div>`;
  section('Hook', 0, 2, (s) => {
    whip(s, { out: '.hook', in: '.product', at: 2, direction: 'right' });   // topic change at 2 s
  });
  section('Product', 2, 2.5, (s) => {
    whip(s, { out: '.product', in: '.end', at: 2.5, direction: 'zoom' });
  });
  section('End', 4.5, 2, () => {});
}
```

### Carry and overlap
```js
// Hook ends at 2.6 s: its title leaves 2.3–2.58 s inside its section.
section('Hook', 0, 2.6, (s) => {
  s.to($('.title'), { y: -30, opacity: 0, duration: 0.28, ease: 'power2.in' }, 2.3);
});
section('Product', 2.6, 3, () => {});
// The card starts 0.08 s (about 2 frames) before the title has left, already moving, and lands on expo.out.
tl.from($('.card'), { y: 60, opacity: 0, duration: 0.45, ease: 'expo.out' }, 2.5);
// It then holds, settled, for the rest of the beat.
```

## Check
- getFrames rounds a time down to its frame, so ask 0.5 ms after each frame: for a cut at 6 s, 5.9675 (T − f), 6.0005 (T) and 6.0675 (T + 2f).
- getFrames at T − f and T: both frames offset about 15% the same way, smeared along the whip axis only (zoom: scaled, softened).
- getFrames at T + 2f: the incoming shot sharp, centered and at rest.
- getFrames at T − 3f: the outgoing shot at rest, still composed where it belongs.
- Carry and overlap: getFrames 0.5 ms after the incoming part's first visible frame and one frame later: it has moved between them, and the outgoing part is still visible in the first.
- Count the shot changes: at most one in three is a whip.

## Example
A 12 s film with four shot changes; the topic changes at 6 s.
- 3 s, 9 s, 10.5 s: hard cuts, each next part arriving 2–4 frames before the last one has left.
- 6 s: whip left, `whip(tl, { out: '.shot-b', in: '.shot-c', at: 6 })`, both shots centered where they were composed.
- getFrames at 5.9675 and 6.0005 shows both shots shifted left and smeared horizontally; at 6.0675 the new shot is sharp and centered.
