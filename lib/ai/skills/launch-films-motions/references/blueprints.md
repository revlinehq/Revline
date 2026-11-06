---
name: "blueprints"
description: "Rebuild a product screenshot as a pixel-perfect blueprint (live HTML with named parts): measure it, score it against the screenshot, save it to the brand kit, and mount it in a scene."
---
# Blueprints: screenshot to pixel-perfect HTML

A blueprint is a kit screen rebuilt as a responsive scene module: every piece (header, sidebar, composer, tab, clip, button) is HTML with a `data-part` name, measured from the screen's pixels and scored against it. Once saved in the brand kit, every film for that brand can mount it.

If the kit already has a blueprint for that screen (listBlueprints), use it; build one only when it is missing. Whether a film shows product UI at all, and how it moves, is decided in launch-films-motions.

## Building one
Fonts and the logo come from the kit; colors and positions come from the screen. Never type a size, color or radius by eye.
1. **Source.** Use an untouched capture from the kit (getBrandKit screens). Never measure an edited screenshot: painting over a badge or cursor also erases what was under it. Ask for a new capture instead.
2. **Measure** with measureScreen: colors at points, and lines across every region (a row across the header, a column down the sidebar, both axes through each button). Each change along a line is an edge. Read every box's **width and height**, not only where it starts, and read corner curves (where the edge reaches the straight side gives the radius). Snap a color to the kit's palette only when they are nearly identical.
3. **Identify the icon set.** Lucide is built in: `icon('scissors', { size, color })` returns the real icon. Match a few icons by shape and use Lucide names. Brand logos and app icons come from findIcon (the official SVG), other icons Lucide lacks from findIcon style ui; draw an SVG only for what neither has.
4. **Build** a scene module that takes `{ root, width, height, brand, media, icon }` and lays the UI out **responsively**: fixed parts keep their measured size (a sidebar 400px wide, a header 56px tall), regions that stretch take the rest, right-hand items anchor to the right edge, centered things stay centered. Give every meaningful piece `data-part`. Use the measured pixels at the screen's size; photos inside the UI (footage, avatars) may be cropped from the screen media.
5. **Compare** with compareScreen (code, at the screen's size). Read the per-part scores, not only the total: a 96% screen can hide a part at 0%. Fix the lowest parts first (look at the red diff image), compare again. Text-heavy parts score lower than flat ones because of anti-aliasing; judge them by the image.
6. **Save** with saveBlueprint (the compare's checkId, a short name, the colors and edges you measured with labels). Aim for 95%+ overall with no flat part (button, panel, divider) under 90%.
7. **Other sizes.** A blueprint renders at any size; check desktop (1920x1080) and laptop (1440x900) with compareScreen width and height when the kit has captures at those sizes; otherwise say those sizes are unverified.

## Using one in a scene
- Attach it: addFilm, addScene or editScene with `brandKitId` and `blueprints: ['Editor']`.
- Mount it: `const ui = blueprint('Editor', container, { width: 1600, height: 1000 })` builds the whole UI inside `container` and returns its root. Scale or tilt the container to frame it.
- Animate its parts: `ui.querySelector('[data-part=composer]')`.
- The blueprint itself stays static; motion is written in the scene.