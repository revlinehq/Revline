---
name: "writing-scenes"
description: "Defines the plain HTML + GSAP module contract that scene clips and films share: the scene() arguments, what loads, fonts, images, project media and limits. Read before the first addFilm, addScene or editScene, together with launch-films-motions for how a film should look and move."
---
# Writing scenes

A scene is a plain TypeScript module that builds HTML once and choreographs it on a GSAP timeline. It renders full-frame on its own V layer, inside a sandbox, frame by frame for preview and export; transparent areas show the layers below.

A good scene follows the contract below exactly, so preview, scrubbing and export show the same frames. A film is one such module placed as one clip with addFilm, its sections written as `section(...)` calls (page `films`).

## Workflow
1. **Existing scene or film:** start with page `edit-lanes` and follow it instead of the steps below.
2. **Read the brief** with readBrief and follow it. Save lasting direction with updateBrief.
3. **Plan** a short outline: a few lines per section with its time range, what moves and the words.
4. **Write** the code directly in the addFilm or addScene call (Rules, Writing).
5. **Check** the rendered frames as launch-films-motions "Before handing back" lists, then call finish.

## Rules

### Writing
- Never draft scene code while thinking. A turn has one output budget for thinking and the call together, and a long draft in thinking leaves nothing for the scene.
- A film: addFilm, as page `films` describes.
- A standalone scene (title card, overlay): addScene, one at a time, checking each before writing the next. If several are simple and independent, addScenes saves them together.

### Contract
- Write `export default function scene({ root, tl, gsap, width, height, duration, fps, brand, media, icon, blueprint, section, shot, push, hit, cursor, beat, downbeat, accent, beats, reveal, exit, swap, counter, type, mark })`. It runs once, before the first frame.
- `root` is the full-frame container on the 1080-based canvas (`width` x `height` px). Build inside it with `root.innerHTML` or `document.createElement`, positioned with absolute px or percentages.
- Never restyle `root` itself.
- `tl` is the scene's GSAP timeline. Time 0 is the clip's first frame, in seconds. How moves go on it: gsap page `revline`.
- `section(name, start, duration, build)` marks a film section (page `films`).
- `shot`, `push`, `hit`, `cursor` and `beat`/`downbeat`/`accent`/`beats` are motion helpers; API reference in page `films`, Motion helpers.
- `reveal`, `exit`, `swap`, `counter`, `type` and `mark` are text functions; API reference in the gsap skill, Text functions.
- `media` holds the project images and videos attached by name (Project media).
- `icon('scissors', { size: 16, color: '#8d8f93', strokeWidth: 2 })` returns a Lucide icon as SVG markup (kebab-case names, as on lucide.dev). Use it for every UI icon instead of drawing one.
- `blueprint('Editor', container, { width, height })` builds a brand kit blueprint attached with `blueprints` inside `container` and returns its root; animate its `[data-part=...]` pieces.
- `brand` is the brand kit attached with brandKitId, or null. Its fields: launch-films-motions page `brand-kit`.
- Scenes are plain TypeScript, never JSX or React.
- Imports: `gsap` and its plugins ({{revline:0}}, plus EasePack), each from `gsap/<Name>` or all from `gsap`. Nothing else loads: no network, no other packages.
- Limits: code up to {{revline:3}} characters per scene and {{revline:4}} per timeline (code shared by several clips counts once), scene clips up to {{revline:5}} s, films up to {{revline:6}} s. finish checks them.

### Fonts and images
- `font-family` may be any of: {{revline:1}}, or the brand kit's families when one is attached.
- Images come from `media` or are inline SVG or data: URIs; nothing loads from the network.

### Project media
- Use the project's media: the user adds files in the editor; over MCP, uploadMedia adds them and getProject lists them. Images (png, jpg, webp) and videos up to 2 minutes.
- Attach them by name: addScene or editScene with `media: [{ name: 'editor', assetId: '…' }]`.
- In code, `media.editor` is a URL: `<img src="${media.editor}">`, `<video src="${media.demo}">` or `background-image:url(${media.editor})`.
- `media.<name>` is undefined when the file is missing, so keep a fallback.
- Videos follow the scene clock, frame-exact, and are always muted (sound belongs on audio clips). Never call play(); the engine seeks them.
- Video attributes: `data-start` is the scene second the video begins (default 0), `data-offset` the source second it starts from, `data-rate` its speed, `data-loop` loops it.
- Treat media like any element: crop it with a wrapper and `overflow:hidden`, zoom with scale and transform-origin, tilt with perspective, mask, blur, stack copies.
- Media is loaded before the first frame, in preview and in exports.

## Example

```ts
{{revline:2}}```

## Pages
- `edit-lanes`: start here for any edit to existing footage, captions, scenes or films.
- `films`: how a film is written as one module with `section(...)` calls, built in parts and edited.
