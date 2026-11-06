---
name: "films"
description: "Explains how a film is written as one plain GSAP module with section() calls: what each section owns, where shared code goes, and how a long film is written in parts. Read before addFilm and before editing a film's code."
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
- Camera elements carry `data-camera` or have "cam" in their selector, variable or id: that is how finish tells the camera, the only element allowed moves over 1 s, from the rest.
- Keep each section's look in its own call and helpers, so shared edits stay rare.

### Long films
- Write a long film in parts as addFilm describes: a marker comment, builtThrough, then patchScene insert for each later part.
- A later part that needs new elements creates them inside its own `section(...)` call (appending to the stage), so the shared code stays untouched.
- Never retype what is already there.

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
