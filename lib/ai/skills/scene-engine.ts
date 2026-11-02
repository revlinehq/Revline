import { threeScenesPage } from './three-scenes';
import { SCENE_FONT_FAMILIES, STARTER_SCENE_CODE } from '../../editor/scene-layers';
import { SCENE_GSAP_PLUGINS } from '../../editor/scene-modules';
import type { EditorSkill, EditorSkillPage } from './index';

const editLanesPage: EditorSkillPage = {
  name: 'edit-lanes',
  description: 'Start here for existing footage, caption, scene or film edits: choose quick or full verification before reading transcript or code.',
  body: `# Editing existing footage, captions, scenes or films

Choose verification by mode, then classify the edit:

- **Fast:** short-form edits, small changes, drafts and iteration such as "make it punchier" or "try another b-roll". Use the quick lane: getFrames at each changed spot and one frame either side. No full-video sweeps, reference compares or repeated re-checks.
- **Precise:** recreations, launch films and work to publish or export as final. Use the full harness, including inventory, 15 fps transition compares, compareReference, checkPacing and close-out where applicable. New films or motion scenes from scratch and reference recreations always run Precise, even when Fast was selected; tell the user in one line. MCP defaults to Precise unless a call passes editMode.

- **Quick lane:** text, label, color, logo, icon or asset swaps, small static style changes, cuts or trims of named passages, trimming to a target length, removing lines, false starts or filler, shortening or swapping one b-roll, and caption text or timing fixes.
- **Full lane (Precise):** building a new edit, restructuring the story, reviewing the whole video, or changing scene motion, timing, camera, transitions, easing or layout over time. Follow the matching implementation skills; for scenes use page \`checklist\`, and for recreations use reference-footage page \`recreation\`.

In Fast, reuse known project context and loaded skills. Skip whole-video review, re-reading every skill, pacing passes and full frame sweeps. Fast may change existing motion locally; Precise uses the full lane. Neither mode skips rendered frame checks.

**Footage and captions:** read only the transcript around the affected SOURCE range with inspectAssetAnalysis start/end or batched windows. Use the fewest calls: batch retained ranges per affected clip with retainSourceRanges, isolating local speech before cleanup. Ripple the actual removed timeline intervals across affected tracks so captions, b-roll and linked audio stay in sync: trim or delete intersecting material and batch moveClips by shared time delta. retainSourceRanges compacts only the linked pair; closeGaps works per layer, so neither alone synchronizes overlays. Preserve unrelated speech and styling. Verify with inspectTimeline: new duration meets the target, no gaps or orphaned captions. Use getFrames at each changed cut point or caption moment and one frame either side (\`t - 1/fps\`, \`t\`, \`t + 1/fps\`, within the timeline).

**Scenes:** find code with inspectClip search, then read only the affected \`section\` (or \`lines\` without section markers). Make one patchScene call where possible, with the same section and expectedRevision. Check getFrames at the changed moment and one frame either side. Confirm everything else is unchanged. In Fast, skip compareReference, motionMap and checkPacing; in Precise, follow the full lane when scene motion changed. Review saved changes with diffScene using revisions from listRevisions, then attach the actual verification evidence with recordFix.`,
};

/** The one list of checks before a scene or film goes back to the user. Other skills point here. */
const checklistPage: EditorSkillPage = {
  name: 'checklist',
  description: 'Full checks for builds and full-lane edits. Existing edits start with edit-lanes. First frames, cuts, beats, pacing, details, measurements, scope, limits and preview speed.',
  body: `# Checklist: before you hand it back

For an existing scene or film edit, follow page \`edit-lanes\` first. Run every item below in Precise for a new build or full-lane edit. Fast follows edit-lanes instead. Render frames with getFrames (up to six per call) and look at them, and run checkPacing on the range you built or changed: stills cannot show speed, so motion that reads fine frame by frame can still be too fast to follow. Never report a film as done from the code alone.

1. **First frames.** The clip's first frame and the next one (start and start + 1/fps). Nothing shows that should still be hidden. A part hidden at its first frame starts hidden where it is built (page \`react-scenes\`, Motion; for GSAP specifics, the gsap skill).
2. **Every cut.** Each cut minus one frame, on the cut, and plus one frame. No flash, no jump; where the beats are meant to connect, the two sides match.
3. **Every beat.** One frame at each beat's key moment. Text sits inside the frame and is readable at the platform's size (a phone for vertical and feed formats); nothing overlaps by accident; one idea per shot.
4. **Pacing.** checkPacing on the changed range. For a recreation, preserve measured reference pacing and use compareMotion to resolve flags. For a new film, fix every flag in the code: every visible change (a new headline, a panel filling in, a menu opening) needs about 1 s of hold before the next one, no more than two changes in a second, one place changing at a time (the eye cannot follow a headline, a timeline and a menu changing together), zooms and pans ease in and out and settle before a cut, no one-sample jumps or flashes. Run it again until the range comes back clean; a flag you keep on purpose needs a reason you can name.
5. **Details, edge by edge.** For every window, card, button and frame you built or changed, look at a frame mid-move (opening, closing, transition) and one after it settles, and go over its edges: exactly one border (no outer stroke, glow or leftover outline an effect leaves behind, no double border), the same corner radius on every corner, no missing or extra lines (frame corners, dividers), nothing clipped or spilling out of its container, text readable against what is behind it (measureFrame both and compare), and no element still on screen after the thing that owns it has closed. Name each one you checked; a frame that only looks fine at a glance is not checked.
6. **Measurements.** Product UI compared with its screenshot at full size (compareScreen), and every reference measured on full-resolution frames, never a downscaled contact sheet (it makes everything look about half its size).
7. **Only what was asked.** On feedback, everything outside the named part is unchanged: same shots, titles, timings, moves, colors and sound. Say what else had to move.
8. **Limits.** Each scene under 120,000 characters and the timeline under 400,000 (shared code counts once), clips up to 120 s.
9. **Preview speed.** Parts that are done or hidden render nothing or \`display: none\`, not only opacity 0; no heavy UI mounted where it cannot be seen.
10. **Sound.** The film has the generated sound music-and-sound asks for (section Scenes), timed to the moments you just checked.
11. **Recreations match.** Follow reference-footage page \`recreation\`: verify every inventory item in rendered pixels, compare every transition at 15 fps, run compareMotion per section and fix its residuals. Close out each item as matched or explicitly off. Scores and pass counts never establish completion.`,
};

const reactScenesPage: EditorSkillPage = {
  name: 'react-scenes',
  description: 'React scenes: the format for launch and feature films. One film = one scene clip on one timeline (addFilm), sections as markers, changed with patchScene; components for structure, GSAP motion through useTimeline, the revline module.',
  body: `# React scenes

For edits to an existing scene or film, start with page \`edit-lanes\` and follow its workflow.

A React scene is a TSX module whose default export is a component. It is a React scene because it imports from \`'revline'\`. Structure is React (components, one film file); motion is GSAP, seeked by the frame clock. The engine renders the tree for each frame, so preview, scrubbing and export draw the same frames.

## Structure
- **One film = one scene clip.** A film is ONE module on ONE continuous timeline, placed as ONE clip for its whole length: its clock counts film seconds from the first frame and \`duration\` is the whole film. addFilm takes the code, the film's title and duration, and named \`sections\` (a title and the film second each starts), which become timeline markers the user and you can point at. There are no clips per beat: a move from one section into the next (an element carried over, a morph, a camera push, a wipe) is one tween in the timeline, with no transition clip and nothing to line up. Split the clip only when the user asks; its parts then show windows onto the same film and still play straight through.
- **Sections inside the film are \`<Beat>\`s at the marker times.** \`<Beat id="composer" start={4.2} duration={3.1}>\` for each section, matching the \`sections\` you pass to addFilm. Whatever runs from one section into the next lives outside those Beats (or in a Beat spanning both), driven by a timeline on film time.
- **One component per part.** Rebuild the product UI as components named for what they are (\`Sidebar\`, \`Composer\`, \`ThreadList\`, \`DiffPanel\`), composed by an app component, all in the film file. The inspector lists the components each clip draws, so names matter.
- **Long films are written in parts.** Keep every call under about 20k tokens (60,000 characters) of code. addFilm gets the whole film's clip and sections and the first part, with markers where the rest goes: \`{/* more beats */}\` where the next \`<Beat>\` belongs and \`/* more parts */\` where the next components belong. Each later part is a patchScene edit that finds the marker with \`insert: 'before'\`, so the marker stays for the next part and the film compiles after every call. Sections not written yet show the stage until their part lands.
- **Approved sections are off-limits.** An approved film section (\`approved\` in inspectTimeline, with the user's note) owns its \`<Beat>\` and every component, style object and helper that Beat uses: patchScene refuses an edit to any of them, and a change to a shared component counts. Keep each section's look in its own components, give every \`<Beat>\` literal \`start\` and \`duration\` numbers, and change approved work only when the user names it (\`overrideApproved: true\` with \`overrideReason\` quoting them).
- **Edit with patchScene; never retype the film.** Read a short block with inspectClip \`section: "Composer"\` or \`lines: {start: 40, end: 65}\`. Its sceneCode.blocks include exact code and absolute, 1-based numberedCode. Patch with the same section and small exact find/replace edits, or \`edits: [{lines: {start: 48, end: 51}, replace: "new lines"}]\` without quoting old code. All line edits in a call use the inspected snapshot; keep ranges separate and pass its revision as expectedRevision. Reinspect after saving. A missing find returns nearby numbered lines for retry. Without section markers, use whole-scene line ranges. Shared-code warnings mean checking transitions on both sides; keep spanning tweens on the shared timeline and use scope covering the affected sections. Never resend the whole film through editScene or rebuild a section as a separate scene.
- **Standalone scenes** (a title card, an overlay, one beat on its own) use addScene, or addScenes for several. Older films made of beat clips with a film kit (\`blueprint:film\`) and \`<Transition>\` clips on V3 still render and edit as before; build new films with addFilm.

## Motion
- **All motion is GSAP through \`useTimeline\`**, from a single fade to staggers, overlaps, word or letter reveals, SplitText, ScrambleText, DrawSVG, MorphSVG and motion paths; read the gsap skill (readSkill name "gsap"). Connected parts are one tween, and moves overlap through position parameters, never through seconds typed by hand. Do not animate with \`progress()\` and \`mix()\` from \`useBeat()\` time: separate hand-timed calls freeze between moves, drift out of sync and jump. It builds a paused GSAP timeline once per mount, scoped to the element it returns a ref for, and seeks it to the beat's local time on every frame:
\`\`\`tsx
function Title({ text }: { text: string }) {
  const ref = useTimeline<HTMLHeadingElement>((tl, el) => {
    const { words } = new SplitText(el, { type: 'words' });
    tl.from(words, { opacity: 0, filter: 'blur(14px)', y: 18, duration: .8, ease: 'expo.out', stagger: .07 }, .2);
  });
  return <h1 ref={ref} style={{ margin: 0, font: '600 84px/1.05 Outfit' }}>{text}</h1>;
}
\`\`\`
  Selector strings inside \`build\` (\`tl.from('.row', …)\`) find only that component's nodes. Let GSAP animate nodes whose style React does not set every render; keep React-computed style and GSAP on different elements.
- **Never** \`gsap.to\`, \`gsap.from\` or \`gsap.set\` outside a useTimeline build, CSS transitions or keyframe animations, timers, requestAnimationFrame, Date or component state that changes over time. None of them follow the frame clock, so they differ between preview, scrubbing and export.
- **No flash frames:** a part hidden at its first frame starts hidden through its timeline (\`tl.from\`/\`tl.fromTo\` apply their start state where the timeline is built) or through computed style at time 0. Beats unmount what is outside their window, so build hidden parts where they first appear.

## The revline module
- \`useBeat()\`: \`{ time, frame, fps, start, duration, progress }\` local to the nearest beat; at the top of a film it is film time. \`useBeat(t => …)\` re-renders only when the selected value changes (\`useBeat(t => t.time > 2)\`).
- \`useScene()\`: \`{ width, height, fps, duration, brand, media }\`; also the scene component's props.
- \`useTimeline((tl, el) => …, deps?)\`: GSAP choreography on the beat clock; returns the ref.
- \`<Beat id start duration track keep>\`: a stretch with its own clock inside one clip. \`start\` is seconds or a reference to an earlier sibling: \`"intro"\`, \`"intro + 0.5"\`, \`"intro - 0.3"\`. Outside its window it renders nothing (\`keep\` keeps it mounted, hidden).
- \`<Layer>\`: full-frame box. \`<Still>\`: children rendered once. \`<Icon name size color strokeWidth>\`: a Lucide icon.
- \`progress\`, \`mix\`, \`ramp(t, times, values, ease)\`, \`spring(t, { from, to, stiffness, damping })\`, \`ease(name)\`: eases use GSAP names.
- \`<Transition>\` and \`<Neighbour role="from" | "to">\` for transition clips between standalone scenes (inside a film, a move across a cut is just a tween). \`waitFor(promise)\` holds a frame until it settles.
- Imports: \`revline\`, \`react\` and \`gsap\` with its plugins (\`gsap/SplitText\` etc.). Fonts, media, icons and the brand work as in GSAP scenes.

## 3D layers
Import from \`revline/three\` to mix a transparent React Three Fiber layer with HTML and GSAP. Read page \`three-scenes\` before authoring cameras, lights, primitives, 3D text or GLB/glTF models.

## Performance
Only components that read time re-render; static parts render once. A useTimeline component does not re-render per frame. Keep heavy static UI in components that never call useBeat, wrap big static subtrees in \`<Still>\`, and prefer \`useBeat(select)\` in hot components.`,
};

export const sceneEngine: EditorSkill = {
  name: 'scene-engine',
  description: 'How scene clips work, for every kind of scene: the module contract, what loads, how frames are rendered, GSAP technique, fonts, images and the brand parameter. Read before the first addScene or editScene, together with the skill for the job (motion-design for launch films and any standalone motion scene, explainer-scenes for explainers and overlays on footage).',
  body: `# Scene engine

For edits to an existing scene or film, start with page \`edit-lanes\` and follow its workflow instead of the build guidance below.

**Project brief first.** Read the project's brief (getProject, inspectTimeline or readBrief) before changing anything, and follow it. When the user gives direction that should last (what to keep, what to avoid, style), update the brief with updateBrief in their own words, replacing the rule it supersedes.

A scene is a TypeScript module that builds plain HTML once and choreographs it on a GSAP timeline. It renders full-frame on its own V layer, inside a sandbox, and the editor renders it frame by frame for preview and export. Transparent areas show the layers below.

Launch and feature films use **React scenes** instead: one film, one clip, built with addFilm, components for structure, GSAP motion seeked through useTimeline (page \`react-scenes\`). The rest of this page describes GSAP scenes, used for explainers and overlays on footage.

## Writing scenes
- Plan the film as a short outline (a few lines per scene: time range, what moves, the words). Never draft scene code while thinking; write it in the addFilm or addScene call. A turn has one output budget for thinking and the call together, and a long draft in thinking leaves nothing for the scene.
- A film (React scenes): write it with addFilm as one clip (page \`react-scenes\`), check every section and the moves between them with getFrames, then fix with patchScene edits, never by retyping it. An explainer of GSAP scenes: one addScene per call, checking each before writing the next. Keep each module well under the code limit.
- Changing any existing scene or film: inspectClip with section or lines for a short numbered read, then patchScene with scoped snippets or line edits and expectedRevision (page \`react-scenes\`). Use inspectClip kit: true for the shared film kit. editScene replaces whole code, so use it only to swap a standalone scene for a new one or to attach a brand kit or media.
- Going back to a version of a scene the user liked: listRevisions (with its clipId) finds the revision, then restoreClip puts that one clip back exactly, leaving every other clip as it is now. Use it, not chains of undoLatestEdit, which also take back later approved work.

## Contract

- Write \`export default function scene({ root, tl, gsap, width, height, duration, fps, brand, media, icon, blueprint })\`. It runs once, before the first frame.
- \`root\` is the full-frame container on the 1080-based canvas (\`width\` x \`height\` px). Build inside it with \`root.innerHTML\` or \`document.createElement\`; never restyle \`root\` itself. Position with absolute px or percentages.
- \`tl\` is the scene's GSAP timeline. Time 0 is the clip's first frame, in seconds. Put every animation on it with a position parameter: \`tl.from(el, { y: 40, opacity: 0, duration: .8, ease: 'expo.out' }, 1.2)\`.
- \`media\` holds the project images attached with addScene/editScene \`media\` (see Project media), by name.
- \`icon('scissors', { size: 16, color: '#8d8f93', strokeWidth: 2 })\` returns a Lucide icon as SVG markup (kebab-case names, as on lucide.dev). Use it for every UI icon instead of drawing one.
- \`blueprint('Editor', container, { width, height })\` builds a brand kit blueprint attached with \`blueprints\` inside \`container\` and returns its root; animate its \`[data-part=...]\` pieces (motion-design, blueprints page).
- \`brand\` is the brand kit attached with brandKitId (fonts already loaded, named colors, logo), or null. See motion-design's \`brand-kit\` page.
- The editor seeks the timeline to each frame, so the film is scrubbable and exports frame-exact. Animate only with GSAP. CSS transitions and keyframes, requestAnimationFrame, timers, Date, video and audio do not follow the clock.
- GSAP scenes are plain TypeScript, not JSX (React scenes, page \`react-scenes\`, are TSX). Imports: \`gsap\` and its plugins (${SCENE_GSAP_PLUGINS.join(', ')}, plus EasePack), each from \`gsap/<Name>\` or all from \`gsap\`. They are registered already. Nothing else loads: no network, no other packages.
- Math.random is seeded, so scatter and noise come out the same in preview and export.
- Limits: code up to 120,000 characters per scene and 400,000 per timeline (code shared by several clips counts once), clips up to 120 s.

## GSAP technique

For choreography, read the gsap skill (readSkill name "gsap"): GreenSock's official guidance under Revline's rules for seeked timelines.

- Choreograph with the position parameter: absolute times (\`2.4\`), relative to the previous step (\`'<0.2'\`, \`'-=0.3'\`), or labels (\`tl.addLabel('reveal', 3)\`, then \`'reveal+=0.4'\`).
- A custom curve is one line: \`CustomEase.create('brand', 'M0,0 C0.4,0 0.2,1 1,1')\`.
- \`stagger\` builds lists, grids, words and characters: \`tl.from(items, { y: 20, opacity: 0, stagger: 0.06 }, 1)\`.
- Text: \`new SplitText(el, { type: 'lines,words,chars' })\` splits for line, word or character reveals; ScrambleTextPlugin decodes text; TextPlugin types it.
- Lines and shapes: DrawSVGPlugin draws strokes (\`drawSVG: '0%'\` to \`'100%'\`), MorphSVGPlugin morphs paths, MotionPathPlugin moves along a path.
- Counting numbers: tween a plain object and write it out in \`onUpdate\`.
- Loops: \`repeat: -1\` with \`yoyo: true\` for drifts, pulses and backgrounds; they stay frame-exact.
- Instant changes (a swap, a hard cut inside a scene, a stepped frame rate): \`tl.set(...)\` at a time, or \`ease: 'steps(n)'\`.
- Rebuild product UI as real HTML (cards, rows, buttons, charts) rather than describing it; it stays sharp at any resolution and every part can move.
- Blur, masks and 3D work: \`filter: blur()\`, \`mask-image\` gradients, and \`perspective\` with rotateX/rotateY on a parent.

## Fonts and images

- \`font-family\` may be any of: ${SCENE_FONT_FAMILIES.join(', ')}, or the brand kit's families when one is attached.
- Images come from \`media\` (see Project media) or are inline SVG or data: URIs; nothing loads from the network. The brand logo arrives as \`brand.logo\` (data URL) and \`brand.logoSvg\` (markup when vector).

## Project media
Real screenshots, screen recordings, photos and logos from the project's media can appear inside a scene:
- Use the project's media (the user adds files in the editor; over MCP, uploadMedia adds them and getProject lists them). Images (png, jpg, webp) and videos up to 2 minutes.
- Attach them by name: addScene or editScene with \`media: [{ name: 'editor', assetId: '…' }]\` (up to 8). A brand kit's saved screens also arrive in \`media\` when the kit is attached; a project item with the same name wins.
- In code, \`media.editor\` is a URL: \`<img src="\${media.editor}">\`, \`<video src="\${media.demo}">\` or \`background-image:url(\${media.editor})\`. It is undefined if the file is missing, so keep a fallback.
- Videos follow the scene clock, frame-exact, and are always muted (sound belongs on audio clips): \`data-start\` is the scene second the video begins (default 0), \`data-offset\` the source second it starts from, \`data-rate\` its speed, \`data-loop\` loops it. Do not call play(); the engine seeks it.
- Treat media like any element: crop it with a wrapper and \`overflow:hidden\`, zoom with scale and transform-origin, tilt it with perspective, mask it, blur it, stack copies.
- Media is loaded before the first frame, in preview and in exports.

## Checking a scene

- Scenes are not effects: never call planEffects or previewRender for a scene clip.
- Before handing a scene or film back, follow page \`edit-lanes\` for existing edits or page \`checklist\` for a new build. Over MCP, getFrames renders the saved timeline at chosen times.

## Example

\`\`\`ts
${STARTER_SCENE_CODE}\`\`\`
`,
  pages: [threeScenesPage, editLanesPage, reactScenesPage, checklistPage],
};
