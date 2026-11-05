---
name: "scene-engine"
description: "How scene clips work, for every kind of scene: the module contract, what loads, how frames are rendered, GSAP technique, fonts, images and the brand parameter. Read before the first addScene or editScene, together with the skill for the job (motion-design for launch films and any standalone motion scene)."
---
# Scene engine

For edits to an existing scene or film, start with page `edit-lanes` and follow its workflow instead of the build guidance below.

**Project brief first.** Read the project's brief (getProject, inspectTimeline or readBrief) before changing anything, and follow it. When the user gives direction that should last (what to keep, what to avoid, style), update the brief with updateBrief in their own words, replacing the rule it supersedes.

A scene is a TypeScript module that builds plain HTML once and choreographs it on a GSAP timeline. It renders full-frame on its own V layer, inside a sandbox, and the editor renders it frame by frame for preview and export. Transparent areas show the layers below.

Launch and feature films use **React scenes** instead: one film, one clip, built with addFilm, components for structure, GSAP motion seeked through useTimeline (page `react-scenes`). The rest of this page describes GSAP scenes, used for overlays on footage.

## Writing scenes
- Plan the film as a short outline (a few lines per scene: time range, what moves, the words). Never draft scene code while thinking; write it in the addFilm or addScene call. A turn has one output budget for thinking and the call together, and a long draft in thinking leaves nothing for the scene.
- A film: page `react-scenes`. GSAP scenes: one addScene per call, checking each before writing the next. Keep each module well under the code limit.
- Changing any existing scene or film: inspectClip with section or lines for a short numbered read, then patchScene with scoped snippets or line edits and expectedRevision (page `react-scenes`). Use inspectClip kit: true for the shared film kit. editScene replaces whole code, so use it only to swap a standalone scene for a new one or to attach a brand kit or media.
- Going back to a version of a scene the user liked: listRevisions (with its clipId) finds the revision, then restoreClip puts that one clip back exactly, leaving every other clip as it is now. Use it, not chains of undoLatestEdit, which also take back later approved work.

## Contract

- Write `export default function scene({ root, tl, gsap, width, height, duration, fps, brand, media, icon, blueprint })`. It runs once, before the first frame.
- `root` is the full-frame container on the 1080-based canvas (`width` x `height` px). Build inside it with `root.innerHTML` or `document.createElement`; never restyle `root` itself. Position with absolute px or percentages.
- `tl` is the scene's GSAP timeline. Time 0 is the clip's first frame, in seconds. Put every animation on it with a position parameter: `tl.from(el, { y: 40, opacity: 0, duration: .8, ease: 'expo.out' }, 1.2)`.
- `media` holds the project images attached with addScene/editScene `media` (see Project media), by name.
- `icon('scissors', { size: 16, color: '#8d8f93', strokeWidth: 2 })` returns a Lucide icon as SVG markup (kebab-case names, as on lucide.dev). Use it for every UI icon instead of drawing one.
- `blueprint('Editor', container, { width, height })` builds a brand kit blueprint attached with `blueprints` inside `container` and returns its root; animate its `[data-part=...]` pieces (motion-design, blueprints page).
- `brand` is the brand kit attached with brandKitId (fonts already loaded, named colors, logo), or null. See motion-design's `brand-kit` page.
- The editor seeks the timeline to each frame, so the film is scrubbable and exports frame-exact. Animate only with GSAP on that timeline (gsap page `revline` lists what never follows the clock).
- GSAP scenes are plain TypeScript, not JSX (React scenes, page `react-scenes`, are TSX). Imports: `gsap` and its plugins ({{revline:0}}, plus EasePack), each from `gsap/<Name>` or all from `gsap`. They are registered already. Nothing else loads: no network, no other packages.
- Math.random is seeded, so scatter and noise come out the same in preview and export.
- Limits: code up to 120,000 characters per scene and 400,000 per timeline (code shared by several clips counts once), clips up to 120 s.

## GSAP technique

Build motion on tl/useTimeline with explicit positions, e.g. `tl.from(el, {y:20, opacity:0, stagger:.06}, 1)`. Use gsap’s core and plugins (motion-design recipes for named transitions) for easing, text, SVG, blur/masks and perspective. Counters write derived text in onUpdate; loops use repeat:-1/yoyo:true; instant changes use tl.set at explicit times or ease:steps(n). Rebuild interacting UI as HTML parts; measure against the real screen with compareScreen.

## Fonts and images

- `font-family` may be any of: {{revline:1}}, or the brand kit's families when one is attached.
- Images come from `media` (see Project media) or are inline SVG or data: URIs; nothing loads from the network. The brand logo arrives as `brand.logo` (data URL) and `brand.logoSvg` (markup when vector).

## Project media
Real screenshots, screen recordings, photos and logos from the project's media can appear inside a scene:
- Use the project's media (the user adds files in the editor; over MCP, uploadMedia adds them and getProject lists them). Images (png, jpg, webp) and videos up to 2 minutes.
- Attach them by name: addScene or editScene with `media: [{ name: 'editor', assetId: '…' }]`. A brand kit's saved screens also arrive in `media` when the kit is attached; a project item with the same name wins.
- In code, `media.editor` is a URL: `<img src="${media.editor}">`, `<video src="${media.demo}">` or `background-image:url(${media.editor})`. It is undefined if the file is missing, so keep a fallback.
- Videos follow the scene clock, frame-exact, and are always muted (sound belongs on audio clips): `data-start` is the scene second the video begins (default 0), `data-offset` the source second it starts from, `data-rate` its speed, `data-loop` loops it. Do not call play(); the engine seeks it.
- Treat media like any element: crop it with a wrapper and `overflow:hidden`, zoom with scale and transform-origin, tilt it with perspective, mask it, blur it, stack copies.
- Media is loaded before the first frame, in preview and in exports.

## Checking a scene

- Scenes are not effects: never call planEffects or previewRender for a scene clip.
- Before handing a scene or film back, follow page `edit-lanes` for existing edits or page `checklist` for a new build. Over MCP, getFrames renders the saved timeline at chosen times.

## Example

```ts
{{revline:2}}```
