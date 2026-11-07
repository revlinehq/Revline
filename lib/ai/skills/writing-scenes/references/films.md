---
name: "films"
description: "Explains how a film is written as one plain GSAP module with section() calls: what each section owns, where shared code goes, and how a long film is written in parts, plus the API reference for the motion helpers (shot, push, beat, cursor, hit). Read before addFilm and before editing a film's code."
---
# Films

A good film module builds its whole DOM once, keeps each section's motion inside its own `section(...)` call, and runs on one continuous timeline, so sections can be read, edited and approved one at a time. It uses the same contract as any scene (SKILL.md, Contract).

## Workflow
1. Build the whole DOM up front in the default function.
2. Put each section's moves inside its `section(...)` call, and helpers only one section uses at top level.
3. Pass addFilm the film's `sections` (title and start second each) matching the calls.
4. For a long film, write it in parts (Rules, Long films).
5. Edit it afterwards with inspectClip and patchScene, one section at a time.

## Rules

### One film, one clip
- `tl` counts film seconds from the first frame; `duration` is the whole film.
- Sections are contiguous: each one starts where the previous ends.
- Split a film into several clips only when the user asks.

### Sections
- `section(name, start, duration, build)` places a child timeline on the film timeline at `start` and passes it to `build`.
- Positions inside it are section-local seconds (0 = section start). The runtime throws if a section's moves run past its `duration`.
- `start` and `duration` are number literals: the engine reads them from the source text.
- A whip between two sections: the `whip(tl, { out, in, at, direction })` helper (launch-films-motions page `shot-changes`); it may straddle a section's end.
- Camera elements carry `data-camera` or have "cam" in their selector, variable or id: that is how finish tells the camera, the only element allowed moves over 1 s, from the rest.
- Keep each section's look in its own call and helpers, so shared edits stay rare.

### Long films
- Write a long film in parts as addFilm describes: a marker comment, builtThrough, then patchScene insert for each later part.
- A later part that needs new elements creates them inside its own `section(...)` call (appending to the stage), so the shared code stays untouched.
- Never retype what is already there.

## Motion helpers
API reference for the helpers a scene receives next to `section`. Each one owns its mechanics (eases, overlaps, decay, guards), so a film only chooses properties. Every option has a default; numbers outside a range are clamped to it. All of them are seek-safe: frame N draws the same picture in preview and export.

### shot
`shot(name, start, duration, options, build)` is a `section` that is its own shot: its own container, its own camera, shown only from `start` to `start + duration`. A film made of shots is separate shots joined by cuts or whips, not one continuous camera world. `start` and `duration` are number literals, as for `section`. `build(tl, shot)` gets the section timeline and `{ name, el, start, duration, end }`.
- `el`: the shot's container (selector or element). Default: the element with `data-shot="<name>"`. Its children move into a camera layer, `shot.camera` (`data-camera`), which `push` moves. Never transform the container or the camera yourself; animate what is inside. The container's own layout (flex, grid centering) does not reach its children once they are in the camera layer: position each child itself (`position:absolute;inset:0;display:grid;place-items:center` to center one).
- The cut lands on the frame nearest `start`, so a literal rounded to milliseconds still cuts on the marker's frame.
- `enter.from`: `'left'`, `'right'`, `'up'`, `'down'`, `'zoom'` or `'none'` (default). The entrance is already moving on the shot's first frame: it began `overlap` frames before the cut, so nothing lands on a frozen frame. A hold after it settles is fine.
- `enter.overlap`: frames, default 4, 0 to 12 (and under `frames`).
- `enter.frames`: the whole entrance, default 14, 6 to 40.
- `enter.distance`: fraction of the frame it travels, default .3, .05 to 1 (`'zoom'` starts at scale 1 + distance / 2).
- `enter.ease`: `'expo'` (default) or `'power4'`, always `.out`.
- `exit`: `'cut'` (default) or `'whip'`: the last 5 frames accelerate out (power4.in), away from the side the next shot enters from. `{ type: 'whip', to: 'left', frames: 5 }` names the side (frames 2 to 12).
- `on`: `'beat'`, `'downbeat'` or `'accent'`: throws unless `start` is on a music marker of that kind (within half a frame), naming the nearest one.
```ts
shot('Editor', 2.4, 3, { enter: { from: 'right' }, exit: 'whip', on: 'downbeat' }, (s, shot) => {
  push(s, { target: '.timeline', amount: .12, at: .5 });
});
```

### push
`push(tl, { target, amount, frames, ease, at, center, camera })` moves the camera toward `target`: fast start, slow end.
- `target`: the element it moves toward (required).
- `amount`: how much closer, default .15 (15%), .04 to 1.5. Under .04 throws: a tiny tail push (97% to 100%) reads as a stutter.
- `frames`: default 0.8 s of frames, 6 to 4 s.
- `ease`: `'expo'` (default) or `'power4'`, always `.out`; never inOut.
- `at`: start, in seconds of `tl`, default 0. A negative `at` throws (usually film seconds on a section's timeline).
- `center`: how far the target moves toward the frame center, default 1, 0 (zoom in place) to 1. The camera never shows the shot's edge.
- `camera`: default the current shot's `el`; required outside a shot.
- A push that overlaps another push on the same camera throws (no double zoom). Add pushes on one camera in time order; each starts where the last one ended.
```ts
push(s, { target: '.cta', amount: .2, frames: 24, at: 1.1 });
```

### beat, downbeat, accent, beats
`beat(n)`, `downbeat(n)` and `accent(n)` return the film second of the n-th (1-based) music marker of that kind; `beats(kind)` returns all of them (`'beats'` default, `'downbeats'`, `'accents'`). They read the markers markMusicBeats put on the timeline, mapped to this film's own clock. Run markMusicBeats on the song's clip with the kind needed first; with no markers of that kind, or an n past the last one, they throw and list what is there.
- Film seconds: on a section's timeline subtract its start, `at: beat(9) - shot.start`.
- A `section` or `shot` may also be timed by markers: `start` as `downbeat(2)`, `duration` as `downbeat(4) - downbeat(2)` (or a marker minus a number). Saving writes the number literals the engine reads, start floored to the millisecond so the cut stays on the marker's frame, plus a comment naming what was written: `shot('Editor', 2.866, 3.566 /* downbeat(2), downbeat(4) - downbeat(2) */, …)`. addFilm and patchScene return them as `beatTiming`; later edits find the literals. A `sections` entry with the same title takes that start.
```ts
hit(s, { at: accent(2) - shot.start, intensity: .6 });
```

### cursor
`cursor(tl, { path, at, clicks, frames, pause, arc, size, color, parent, type })` draws a pointer that moves along `path` on a natural curve (eases in, slight arc, decelerates into each point), clicks with a press and a ripple, and can type into a field. Returns `{ el, end, arrivals }`: the cursor element, the `tl` second it finishes, and when it reaches each point.
- `path`: targets (selectors or elements, aimed at their center) or `{ x, y }` px in `parent` (required). It appears at the first point at `at`.
- `at`: default 0. `clicks`: `'last'` (default), `'all'`, `'none'` or path indexes like `[1, 3]`.
- `frames`: frames per move, default from distance (10 frames to 1.4 s), 6 to 3 s. `pause`: frames after each click, default 6, 0 to 60.
- `arc`: bow of each move as a fraction of its length, default .12, 0 to .4. `size`: px, default 30, 14 to 80. `color`: default `'#ffffff'`.
- `parent`: default the current shot's camera, so a push carries the pointer with the UI; else `root`.
- `type: { el, text, cps, caret }` types `text` into `el` after the last move and click: `cps` characters per second, default 14, 4 to 40; the caret stays solid while typing and blinks for `caret` seconds after, default 1, 0 to 10. The field's own content is replaced when typing starts.
```ts
const pointer = cursor(s, { path: [{ x: 1400, y: 820 }, '.prompt'], at: .3, type: { el: '.prompt-text', text: 'Make it cinematic' } });
```

### hit
`hit(tl, { at, intensity, frames, axis, flash, punch, target })` is an impact: a shake that is hardest on the frame at `at` and decays to rest exactly `frames` later, an optional one-frame flash and a punch-in scale.
- `at`: default 0. `intensity`: default .5, 0 to 1 (1 moves 3.5% of the frame). `frames`: default 10, 3 to 30.
- `axis`: `'both'` (default, with a slight rotation), `'x'` or `'y'`.
- `flash`: `false` (default), `true` (white) or a CSS color, for exactly one frame.
- `punch`: extra scale at the hit, default .04, 0 to .25, settling with the shake.
- `target`: default the current shot's `el`, else `root`. On those, the scale also covers the shake so no edge shows. Another target must not have GSAP transforms of its own (x, y, scale, rotation): GSAP clears the CSS translate the shake uses.
```ts
hit(s, { at: 1.6, intensity: .7, flash: true });
```

## Example
```ts
import { SplitText } from 'gsap/SplitText';

export default function scene({ root, tl, duration, section }) {
  root.innerHTML = `
    <div class="stage" style="position:absolute;inset:0;background:#141413;color:#F4F4F0">
      <h1 class="title" style="position:absolute;left:10%;top:40%;margin:0;font-size:112px">Ship faster</h1>
      <div class="card" style="position:absolute;left:20%;top:30%;width:60%;height:40%;border-radius:24px;background:#2a2a2a"></div>
    </div>`;
  const title = root.querySelector('.title');
  const card = root.querySelector('.card');

  tl.to(root.querySelector('.stage'), { scale: 1.04, duration, ease: 'none' }, 0);   // shared: spans every section

  section('Hook', 0, 3, (s) => {
    s.from(new SplitText(title, { type: 'words' }).words, { yPercent: 60, opacity: 0, duration: .45, ease: 'power3.out', stagger: .06 }, .2)
      .to(title, { y: -40, opacity: 0, duration: .3, ease: 'power2.in' }, 2.6);
  });

  section('Product', 3, 4, (s) => {
    s.from(card, { y: 60, scale: .96, opacity: 0, duration: .4, ease: 'power3.out' }, 0);   // from() hides it from the first frame
  });

  // --- more sections
}
```
