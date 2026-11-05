---
name: "react-scenes"
description: "React scenes: the format for launch and feature films. One film = one scene clip on one timeline (addFilm), sections as markers, changed with patchScene; components for structure, GSAP motion through useTimeline, the revline module."
---
# React scenes

For edits to an existing scene or film, start with page `edit-lanes` and follow its workflow.

A React scene is a TSX module whose default export is a component. It is a React scene because it imports from `'revline'`. Structure is React (components, one film file); motion is GSAP, seeked by the frame clock. The engine renders the tree for each frame, so preview, scrubbing and export draw the same frames.

## Structure
- **One film = one scene clip.** A film is ONE module on ONE continuous timeline, placed as ONE clip for its whole length: its clock counts film seconds from the first frame and `duration` is the whole film. addFilm takes the code, the film's title and duration, and named `sections` (a title and the film second each starts), which become timeline markers the user and you can point at. There are no clips per beat: a move from one section into the next (an element carried over, a morph, a camera push, a wipe) is one tween in the timeline, with no transition clip and nothing to line up. Split the clip only when the user asks; its parts then show windows onto the same film and still play straight through.
- **Sections inside the film are `<Beat>`s at the marker times.** `<Beat id="composer" start={4.2} duration={3.1}>` for each section, matching the `sections` you pass to addFilm. Whatever runs from one section into the next lives outside those Beats (or in a Beat spanning both), driven by a timeline on film time.
- **One component per part.** Rebuild the product UI as components named for what they are (`Sidebar`, `Composer`, `ThreadList`, `DiffPanel`), composed by an app component, all in the film file. The inspector lists the components each clip draws, so names matter.
- **Long films are written in parts.** Keep every call under about 20k tokens (60,000 characters) of code. addFilm gets the whole film's clip and sections and the first part, with markers where the rest goes: `{/* more beats */}` where the next `<Beat>` belongs and `/* more parts */` where the next components belong. Each later part is a patchScene edit that finds the marker with `insert: 'before'`, so the marker stays for the next part and the film compiles after every call. Sections not written yet show the stage until their part lands.
- **Approved sections are off-limits.** An approved film section (`approved` in inspectTimeline, with the user's note) owns its `<Beat>` and every component, style object and helper that Beat uses: patchScene refuses an edit to any of them, and a change to a shared component counts. Keep each section's look in its own components, give every `<Beat>` literal `start` and `duration` numbers, and change approved work only when the user names it (`overrideApproved: true` with `overrideReason` quoting them).
- **Edit with patchScene; never retype the film.** Read a short block with inspectClip `section: "Composer"` or `lines: {start: 40, end: 65}`. Its sceneCode.blocks include exact code and absolute, 1-based numberedCode. Patch with the same section and small find/replace edits, or `edits: [{lines: {start: 48, end: 51}, replace: "new lines"}]` without quoting old code. Snippet matching tolerates line indentation differences only when unique; ambiguous matches save nothing. Read ranges past EOF are clamped to the actual source. All line edits in a call use the inspected snapshot; keep ranges separate and pass its revision as expectedRevision. Nonoverlapping changed lines since that revision are merged; conflicts save nothing and return nearby numbered code. Reinspect after saving. A missing find returns nearby numbered lines for retry. A code change isolated to one Beat infers scope; shared edits still need scope covering the affected sections. Title-only edits need no scope, and binding-only refreshes without scope must leave every existing section visually unchanged. Without section markers, use whole-scene line ranges. Shared-code warnings mean checking transitions on both sides; keep spanning tweens on the shared timeline and use scope covering the affected sections. Never resend the whole film through editScene or rebuild a section as a separate scene.
- **Standalone scenes** (a title card, an overlay, one beat on its own) use addScene, or addScenes for several. Older films made of beat clips with a film kit (`blueprint:film`) and `<Transition>` clips on V3 still render and edit as before; build new films with addFilm.

## Motion
- **All motion is GSAP through `useTimeline`**, from a single fade to staggers, overlaps, word or letter reveals, SplitText, ScrambleText, DrawSVG, MorphSVG and motion paths; read the gsap skill (readSkill name "gsap"). Connected parts are one tween, and moves overlap through position parameters, never through seconds typed by hand. Do not animate with `progress()` and `mix()` from `useBeat()` time: separate hand-timed calls freeze between moves, drift out of sync and jump. It builds a paused GSAP timeline once per mount, scoped to the element it returns a ref for, and seeks it to the beat's local time on every frame:
```tsx
function Title({ text }: { text: string }) {
  const ref = useTimeline<HTMLHeadingElement>((tl, el) => {
    const { words } = new SplitText(el, { type: 'words' });
    tl.from(words, { opacity: 0, filter: 'blur(14px)', y: 18, duration: .8, ease: 'expo.out', stagger: .07 }, .2);
  });
  return <h1 ref={ref} style={{ margin: 0, font: '600 84px/1.05 Outfit' }}>{text}</h1>;
}
```
  Selector strings inside `build` (`tl.from('.row', …)`) find only that component's nodes. Let GSAP animate nodes whose style React does not set every render; keep React-computed style and GSAP on different elements.
- **Never** `gsap.to`, `gsap.from` or `gsap.set` outside a useTimeline build, CSS transitions or keyframe animations, timers, requestAnimationFrame, Date or component state that changes over time. None of them follow the frame clock, so they differ between preview, scrubbing and export.
- **No flash frames:** a part hidden at its first frame starts hidden through its timeline (`tl.from`/`tl.fromTo` apply their start state where the timeline is built) or through computed style at time 0. Beats unmount what is outside their window, so build hidden parts where they first appear.

## The revline module
- `useBeat()`: `{ time, frame, fps, start, duration, progress }` local to the nearest beat; at the top of a film it is film time. `useBeat(t => …)` re-renders only when the selected value changes (`useBeat(t => t.time > 2)`).
- `useScene()`: `{ width, height, fps, duration, brand, media }`; also the scene component's props.
- `useTimeline((tl, el) => …, deps?)`: GSAP choreography on the beat clock; returns the ref.
- `<Beat id start duration track keep>`: a stretch with its own clock inside one clip. `start` is seconds or a reference to an earlier sibling: `"intro"`, `"intro + 0.5"`, `"intro - 0.3"`. Outside its window it renders nothing (`keep` keeps it mounted, hidden).
- `<Layer>`: full-frame box. `<Still>`: children rendered once. `<Icon name size color strokeWidth>`: a Lucide icon.
- `progress`, `mix`, `ramp(t, times, values, ease)`, `spring(t, { from, to, stiffness, damping })`, `ease(name)`: eases use GSAP names.
- `<Transition>` and `<Neighbour role="from" | "to">` for transition clips between standalone scenes (inside a film, a move across a cut is just a tween). `waitFor(promise)` holds a frame until it settles.
- Imports: `revline`, `react` and `gsap` with its plugins (`gsap/SplitText` etc.). Fonts, media, icons and the brand work as in GSAP scenes.

## Performance
Only components that read time re-render; static parts render once. A useTimeline component does not re-render per frame. Keep heavy static UI in components that never call useBeat, wrap big static subtrees in `<Still>`, and prefer `useBeat(select)` in hot components.