---
name: "films"
description: "Films: one plain GSAP module on one timeline, placed as one clip with addFilm. Sections are section() calls that own their code; long films are written in parts at an insertion marker; patchScene edits a section; approved sections are locked."
---
# Films

For edits to an existing film, start with page `edit-lanes` and follow its workflow.

A film uses the same contract as any scene (SKILL.md, Contract): a plain TypeScript module that builds HTML into `root` once and puts every tween on a seeked timeline. No JSX, no components, no other runtime.

## One film = one clip
- A film is ONE module on ONE continuous timeline, placed as ONE clip for its whole length with addFilm. `tl` counts film seconds from the first frame; `duration` is the whole film.
- addFilm's `sections` (a title and the film second each starts) become timeline markers. Sections are contiguous: each one starts where the previous ends.
- A move from one section into the next (an element carried over, a morph, a camera push, a wipe) is one tween on the outer `tl`, never a transition clip. Split the clip only when the user asks.

## Sections
`section(name, start, duration, build)` places a child timeline on the film timeline at `start` and passes it to `build`. Positions inside it are section-local seconds (0 = section start); the runtime throws if a section's tweens run past its `duration`.
- `start` and `duration` are number literals in the code, and match addFilm's `sections`: each section's `at` equals its call's `start`. The engine reads them from the source text.
- A section **owns** its whole `section(...)` call plus every top-level declaration (a function or constant at column 0, outside the default export) that call references.
- Everything else in the default function body is **shared**: building the HTML, persistent backgrounds, a camera move spanning sections. Editing shared code warns and checks the other sections.
- So: build the whole DOM up front in the default function, put each section's motion inside its `section(...)` call, put helpers only one section uses at top level, and put moves that cross a boundary on the outer `tl`.
- A part hidden at its first frame gets its starting state where it is built (gsap page `revline`).

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

## Long films are written in parts
Keep every call under about 60,000 characters of code. addFilm gets the whole film's duration and all its `sections`, plus the first part's code with `builtThrough` set to where that part ends, and an insertion marker comment inside the default function (`// --- more sections`). Each later part is a patchScene that inserts `before` that marker, so the marker stays for the next part and the film runs after every call. A later part that needs new elements creates them inside its own `section(...)` call (appending to the stage), so the shared code stays untouched; never retype what is already there.

## Editing
- Read with inspectClip `section` (only that section's owned code) or `lines`, then patchScene with the same `section` and small edits. Never resend the whole film through editScene or rebuild a section as a separate scene.
- **Approved sections are off-limits.** approveClip with a section locks it: patchScene refuses any change to its owned code. Keep each section's look in its own call and helpers so shared edits stay rare, and change approved work only when the user names it.

## Standalone scenes
A title card, an overlay or one moment on its own uses addScene (addScenes for several), with the same contract and no `section` calls.
