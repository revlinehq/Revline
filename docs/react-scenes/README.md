# React scenes (opt-in prototype)

A scene can be a React component tree instead of a GSAP module. The format is opt-in: a scene is drawn with React when its code imports from `'revline'` (or `'react'`). Every existing scene keeps the GSAP format, and nothing about how GSAP scenes compile, load or render has changed.

The format is Revline's own, built on HyperFrames. It uses no Remotion code, API names or renderer.

## How it works

- **Frame adapter.** `lib/editor/scene-react-runtime.tsx` exports `createReactSceneAdapter`, a HyperFrames `FrameAdapter` (`id`, `init`, `getDurationFrames`, `seekFrame`, `destroy`). `seekFrame(frame)` sets the clock and commits the tree synchronously (`flushSync`). The scene frame (`lib/editor/scene-runtime.ts`) calls it in place of `master.seek`, then answers `painted` once fonts, images, videos and any `waitFor` promises have settled. Preview, scrubbing and export all go through this one path.
- **Loaded once, only when needed.** React, ReactDOM and the adapter ship as `public/vendor/scene-react.js` (228 KB minified, built by `scripts/copy-vendor.mjs`). The composition fetches it once and inlines it only into frames whose scene is a React scene. GSAP scene frames are unchanged. Scene code still counts against `SCENE_LIMITS.code` on its own. Exports copy the file when a timeline has a React scene.
- **Compilation.** Scene code is compiled where it was before, by sucrase: TSX with the automatic JSX runtime for React scenes, plain TS for GSAP scenes. `sceneTransformOptions` in `scene-modules.ts` is shared by the frame and by `checkSceneCode`, the Convex save check. React scenes may import `revline`, `react` and `gsap`.
- **Time is an input.** Components read time with `useBeat()`, which subscribes to the frame clock through `useSyncExternalStore`. A seek re-renders only the components that read time. Static subtrees (anything that does not call `useBeat`, plus `memo` components and `<Still>`) are never re-rendered after they mount.
- **Beats.** A `<Beat>` has its own local clock and uses HyperFrames' timing grammar. `start` is seconds or a reference to an earlier sibling: `"intro"`, `"intro + 0.5"` or `"intro - 0.3"`, parsed by HyperFrames' own `parseStartExpression`. The other props are `duration`, `track` (stacking, like `data-track-index`) and `keep`. A beat renders a `div` with `data-start`, `data-duration` and `data-track-index`. Outside its window it renders nothing, unless `keep` is set.

### The `revline` module

| Export | What it does |
| --- | --- |
| `useBeat()` / `useBeat(select)` | Local `{ time, frame, fps, start, duration, progress }`. With `select`, the component re-renders only when the selected value changes. |
| `useTimeline((tl, el) => …, deps?)` | GSAP choreography on the beat clock. Builds a paused timeline once per mount inside a `gsap.context` scoped to the returned ref's element, seeks it to the beat's local time on every frame (from the clock, without re-rendering the component), and reverts it on unmount. Start states apply where it is built, so nothing flashes. |
| `useScene()` | `{ width, height, fps, duration, brand, media }` (also the scene component's props). |
| `Beat`, `Layer`, `Still` | A timed section with its own clock; a full-frame box; children rendered once. |
| `Icon`, `Blueprint` | A Lucide icon as an SVG element; a brand kit blueprint built once into a box. |
| `progress(t, start, duration, ease)` | Eased 0..1 progress of a window. Eases use GSAP's vocabulary (`'expo.out'`, `'power3.inOut'`, `'back.out(1.7)'`, `'steps(4)'`). |
| `ramp(t, times, values, ease)`, `mix(a, b, p)`, `ease(name)` | A piecewise value over time, linear mixing, and an easing function by name. |
| `spring(t, { from, to, stiffness, damping, mass, velocity })` | A damped spring, solved in closed form so every frame stands on its own. |
| `waitFor(promise)` | Holds the frame (preview and export) until the promise settles. |

## The test port

`t3-code-beat.tsx` is the first beat of the "T3 Code film" scene (clip `776110f8…`, dev project `j972wnjj…`), local seconds 0 to 8.15. In that window the dashboard assembles, the camera dives into the composer, the prompt is typed and sent, and the reply streams in. The repo's typecheck checks the file against the runtime's types, through the `revline` path in `tsconfig.json`.

The original handled its time with a remap function (`D(o)` adds 1.85 s, adds 1.2 s after 9 s, takes off 0.9 s after 7 s), plus raw and remapped timelines side by side. The port has three beats instead, each on its own clock: `intro`, `assembly` at 0.5 s and `chat` at `start="assembly"`. A caption starts at `"assembly - 0.2"`. Both copies of the app (one for the assembly, one for the chat) come from one `T3App` component. The prompt's caret sits inline after the typed text, so the original's per-keystroke width measurement is gone.

At 1.9 s, 4.4 s and 6.4 s, the React and GSAP frames match visually in the dev preview: dev project "React scene prototype (bench)" (`j975gr3qjmc2ckwkhxfqe05xp98h7z22`), tab "React scene prototype". The tab holds the original film (at 0 s), the GSAP beat trimmed to the same window (at 20 s) and the React beat (at 29 s).

## Beat clips and transition clips

The timeline can show the film's structure: each beat is its own scene clip, and each transition is its own clip between two beats. `clips/` holds the T3 port split this way:

| Clip | Track | Time | What it is |
| --- | --- | --- | --- |
| `t3-code-kit.tsx` | (blueprint "T3 Code") | — | T3 Code's app as components: `T3App`, `Window`, `Sidebar`, `ThreadHeader`, `ComposerControls`, `ComposerFooter`, `DiffHeader`, `DiffHunk`, `Caption`… |
| `beat-assembly.tsx` | V2 | 0 – 3.75 s | The title blows away, the dashboard builds, then everything but the composer clears |
| `transition-zoom-into-composer.tsx` | V3 | 2.85 – 3.75 s | `<Transition kind="zoom-into" target="composer" …/>` |
| `beat-chat.tsx` | V2 | 3.75 – 8.15 s | Typing, send, pull back to the reply |

This is in the dev bench project, tab "React beat clips". The transition's last frame and the chat beat's first frame are pixel-identical (mean difference 0.004/255).

### Shared components: React blueprints

A beat imports components from a blueprint attached to its clip: `import { Window, Caption } from 'blueprint:T3 Code'`. Blueprints are the existing per-scene attachment (up to 4, stored once by hash), so a kit shared by every beat of a film is stored once. Editing a kit component changes every beat that uses it. Editing a beat clip changes only that beat.

### Transition clips render both neighbours

A transition clip is a React scene that draws `<Transition>` (or `<Neighbour>` directly). When the composition builds its sources (`sceneNeighbours` in `scene-layers.ts`), it gives the transition its neighbours, each with its code, blueprints and timing:
- **from:** the React beat clip playing (or last played) when the transition starts;
- **to:** the one playing (or next to play) when it ends.

Any track works; the transition usually sits on the layer above, across the cut.

Inside the frame:
- **Own clocks:** `<Neighbour role="from" | "to">` mounts that beat's component on its own clock. Its time maps from the transition's clock, and it holds its first or last frame outside its own range.
- **Live outgoing beat:** an overlapping transition keeps the outgoing beat playing underneath. Here, the assembly's own fades continue under the camera move.
- **Transition kinds:** `crossfade`, `blur-through`, `zoom-into` and `pull-back`.
  - The camera moves are computed from the beats themselves. Each frame, the transition measures the `target` element (`[data-anchor="composer"]`) where the beat draws it at that moment.
  - It then moves the beat's `[data-camera]` element so that point lands at `at` with `zoom`. Overlays outside `data-camera`, such as captions, stay put.
  - `origin`, `at`, `zoom`, `fade` and `ease` tune it.
- **Cost:** a transition frame mounts both beats (650 elements here) and costs 0.68 ms of JS per frame, against 0.34 ms for the chat beat alone.

### Component metadata per clip

`sceneComponents(scene)` in `scene-modules.ts` reads the clip's code statically, so nothing needs rendering. It lists:
- the components the clip declares;
- every exported blueprint component it reaches (a kit's internal helpers are walked, not listed);
- `Transition` or `Neighbour`.

`inspectClip` returns it as `components`, and the timeline's scene code dialog ("View code") shows it as chips. For the chat beat, the list is Window, T3App, Sidebar, ThreadHeader, ChangedFiles, ComposerControls, ComposerFooter, DiffHeader, DiffHunk, Chat, Caption.

The list is static: it shows what a clip can draw, not what is on screen at a given time. The chat beat lists `Sidebar` even though it never shows it. An exact list would need a render pass that records mounted components per frame.

### Limits of this prototype

- Transition detection reads the code (`<Transition` or `<Neighbour`), and neighbours are chosen by time. A real version should store `scene.transition = { from, to }` clip ids on the clip, so moving clips keeps the pairing explicit.
- `checkSceneCode` accepts `blueprint:<name>` imports. But `saveBlueprint` and blueprint checks (`blueprint-check.ts`) still assume GSAP blueprints, so React kits were attached directly for this test.
- `TIMELINE_SCENE_CODE_LIMIT` counts a blueprint once per clip that attaches it. With five beats sharing a 26 KB kit, that is 130 KB of the 180 KB budget, so it should count each hash once.
- The "Typing here…" caption now starts with the chat beat (3.75 s), 0.2 s later than the original, because it no longer lives in the transition window.

## Measurements

The method: each scene runs through the real frame protocol (`init`, `seek`, `painted`) using the built `scene-runtime.js` and `scene-react.js`, in headless Chrome at 1920×1080 with 30 fps and the same fonts and icons. The window is the beat's 245 frames.

- **GSAP original** is the whole 19.4 s film, as it runs today.
- **GSAP beat** is the same code cut at the 7.2 s cue, without the browser panel. This is the like-for-like baseline.
- **Export** draws every frame in order (seek, `painted`, two animation frames), then takes a JPEG capture of each, as the producer does.
- **Scrub** makes 80 seeded random jumps.
- **Play** runs in real time and drops any frame that is not drawn before its slot.

The numbers are medians of 3 runs (unthrottled) and 2 runs (4× CPU throttle).

### Code size

| | Characters | Minified | Gzipped |
| --- | --- | --- | --- |
| GSAP original, whole film (as stored, already minified) | 28,253 + 12,999 blueprint | — | — |
| GSAP beat (same window) | 25,552 (22,441 without the unused browser panel) | 25,543 | 9,301 |
| React beat, readable TSX | 31,630 | 22,893 | 8,089 |

The readable React beat is about the size of the minified GSAP one. Minified, it is 10% smaller, and 13% smaller gzipped.

### Unthrottled (M-series Mac)

| | GSAP original | GSAP beat | React beat |
| --- | --- | --- | --- |
| Mount: parse runtime | 81 ms | 68 ms | 91 ms |
| Mount: build scene | 208 ms | 110 ms | 56 ms |
| Mount: total to first frame | 315 ms | 214 ms | 163 ms |
| Export: seek JS per frame (mean / p95) | 0.8 / 2.3 ms | 0.4 / 1.0 ms | 1.0 / 1.7 ms |
| Export: capture per frame | 55 ms | 34 ms | 34 ms |
| Scrub: seek + layout (mean / p95) | 1.6 / 3.8 ms | 1.1 / 2.9 ms | 1.9 / 5.7 ms |
| Play: frames drawn | 30 fps | 30 fps | 30 fps |
| DOM elements in the frame | 1,255 | 929 | 558 (assembly), 100 (chat) |

### 4× CPU throttle

| | GSAP original | GSAP beat | React beat |
| --- | --- | --- | --- |
| Mount: parse / build / total | 426 / 1,376 / 1,844 ms | 430 / 995 / 1,454 ms | 513 / 683 / 1,232 ms |
| Export: seek JS per frame (mean / p95) | 5.2 / 12.4 ms | 3.6 / 9.2 ms | 7.2 / 10.4 ms |
| Export: capture per frame | 124 ms | 89 ms | 63 ms |
| Scrub: seek + layout (mean / p95) | 10.5 / 40 ms | 8.4 / 24 ms | 16.2 / 52 ms |
| Play: frames drawn | 29.6 fps | 30 fps | 29.9 fps |

### Reading the numbers

- **Mount:** React is faster to the first frame (−24% against the like-for-like GSAP beat, −15% throttled), even though parsing React costs about 25 ms more (80 ms throttled). It builds only the visible beat, while GSAP builds every element of the film up front.
- **Per-frame JS:** React costs more, about 2× GSAP (1.0 against 0.4 ms; 7 against 4 ms throttled), because the time-reading components re-render and React reconciles. Both stay far inside a 33 ms frame.
- **Scrubbing:** jumping between beats is where React pays most: p95 52 ms against 24 ms throttled. Crossing a beat boundary mounts that beat's subtree. `keep` on beats that scrubbing crosses often trades the remount for hidden DOM.
- **Export:** the capture, not the seek, dominates export. React's smaller live DOM makes capture cheaper (63 against 89 ms throttled). The whole export frame (draw plus capture) took 85 ms for React against 107 ms for the GSAP beat throttled, about 20% faster. Unthrottled it took 50 ms against 41 ms, about 20% slower. In that case the draw times sit near vsync granularity, so treat that difference as noise-sized.
- **Playback:** all three held 30 fps here. The editor's preview lag is not from the scene seek itself, which stays in single-digit milliseconds. It comes from the size of the live DOM, which React keeps smaller because offscreen beats do not exist.

These numbers come from headless Chrome. The editor pane was hidden during this session, so frame timing there would have been throttled and was not used.

## Decision (2026-10-29)

Films use GSAP for motion and React for structure:
- **Structure:** components, one per part, in one clip per beat, with transition clips between beats.
- **Motion:** simple fades and slides use `progress()`/`mix()`; choreography uses `useTimeline`.

The agent learns this from the scene-engine skill's `react-scenes` page and the motion-design skill.

A word-by-word blur-in title built with `useTimeline` draws byte-identical frames in playback order and in shuffled scrub order (96 of 96). Its first frame and the next beat's first frame show only the background.

## Recommendation

Keep React scenes as an opt-in format, and use them for UI-heavy launch-film beats. They fix all three pains:

- **Time bookkeeping:** local beat clocks plus HyperFrames' relative `start`.
- **Ordering bugs:** a frame is a pure function of time. There are no `immediateRender` or `gsap.set`-before-tween traps, and no clones carrying animation state.
- **Reusable UI:** components replace the three copies of HTML-string builders.

They are also faster to mount, and faster to export on a slow CPU. The costs are 228 KB loaded per React scene frame, about 1 ms more JS per frame, and slower scrubbing across beat boundaries.

For film structure, build each beat as its own React scene clip, with the film's UI in one React blueprint kit. Make each transition its own clip drawing `<Transition>`, as in the T3 split above.

Before making React the default:

1. Teach the format in the scene-engine skill (contract, `revline` API, beat grammar) and have the agent author one launch film in it.
2. Cut per-frame re-renders. Selector-based `useBeat` already does this; use it in hot components, and consider a `<Animated style={t => ...}>` primitive that writes styles straight to its node without reconciling.
3. Pre-mount the next beat one beat ahead (or default to `keep` for short films) to flatten the scrub p95.
4. Measure inside the visible editor preview on a slower machine, and run a full producer export of a React-scene timeline.
5. Make film structure first-class:
   - store transition pairing on the clip (`scene.transition`);
   - let `saveBlueprint` hold React kits;
   - count shared blueprint code once per timeline;
   - add an `addTransition`-style tool that drops a transition clip on a cut between two beat clips.
