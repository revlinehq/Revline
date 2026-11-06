---
name: "blueprints"
description: "Rebuilds a product screenshot as a pixel-perfect blueprint (live HTML with named parts), scores it against the screenshot, saves it to the brand kit and mounts it in a film. Read when a film shows the user's product UI: it decides per shot between the screenshot and a blueprint, and builds a blueprint when the kit has none for that screen."
---
# Blueprints: screenshot to pixel-perfect HTML

A good blueprint is a kit screen rebuilt as a responsive scene module: every piece (header, sidebar, composer, tab, button) is HTML with a `data-part` name, measured from the screen's pixels and scoring 95%+ against it. Once saved in the kit, every film for that brand can mount it.

## Workflow
1. **Choose per shot** between the screenshot and a blueprint (Rules). For a blueprint, check listBlueprints first. If the kit has one for that screen, use it and skip to step 8.
2. **Source.** Use an untouched capture from the kit (getBrandKit screens). If the only capture is edited, ask for a new one: painting over a badge or cursor also erases what was under it.
3. **Measure** with measureScreen: a row across the header, a column down the sidebar, both axes through each button. Read every box's width, height and corner radius, and build at the screen's size from those pixels.
4. **Icons.** Match a few icons by shape to Lucide names and use `icon(...)`. Brand logos and app icons come from findIcon; other icons Lucide lacks from findIcon style ui. Draw an SVG only for what neither has.
5. **Build** a module that takes `{ root, width, height, brand, media, icon }` and gives every meaningful piece `data-part`.
6. **Compare** with compareScreen at the screen's size. Fix the lowest-scoring parts, compare again.
7. **Save** with saveBlueprint once it scores 95%+ overall with no flat part (button, panel, divider) under 90%.
8. **Mount** it in the film (Example below).

## Rules
- **Screenshot or blueprint, per shot:** when the whole UI moves or holds, use the screenshot (`media.<screen>`). When something inside the UI moves, zooms past 2× or changes text, use the kit's blueprint.
- Fonts and the logo come from the kit; colors and positions come from the screen. Never type a size, color or radius by eye.
- Snap a measured color to the kit's palette only when they are nearly identical.
- Lay the UI out responsively: fixed parts keep their measured size (a sidebar 400 px wide, a header 56 px tall), stretching regions take the rest, right-hand items anchor right, centered things stay centered.
- Photos inside the UI (footage, avatars) may be cropped from the screen media.
- Read per-part scores, not only the total: a 96% screen can hide a part at 0%. Judge text-heavy parts by the diff image.
- Check desktop (1920x1080) and laptop (1440x900) with compareScreen width and height when the kit has captures at those sizes. Otherwise say those sizes are unverified.
- Attach it with `brandKitId` and `blueprints: ['Editor']` on addFilm, addScene or editScene. Scale or tilt the container to frame it.
- The blueprint stays static; its motion is written in the film's sections.

## Example
```ts
const ui = blueprint('Editor', root.querySelector('.device'), { width: 1600, height: 1000 });
section('Composer', 4, 3, (s) => {
  s.from(ui.querySelector('[data-part=composer]'), { y: 40, opacity: 0, duration: .35, ease: 'power3.out' }, .2);
});
```
