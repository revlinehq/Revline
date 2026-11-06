---
name: "image-plates"
description: "Decides when a film needs a generated image asset (photoreal subject, texture, background plate, cut-out) and how to brief, check and attach it. Read before calling generateImage."
---
# Image plates

A good plate is one useful asset that code could not draw, in the film's palette, with no text, framed for its exact use and checked before it is placed.

## Workflow
1. **Decide:** generate only what neither code nor findIcon or traceShape can make (generateImage lists that order): hands, physical objects, products, photos, textures, backgrounds and cut-outs.
2. **Brief** one asset with the seven prompt items (Rules, Prompt).
3. **Generate** one variant first. Ask for alternatives only when they are useful.
4. **Inspect** the preview: subject, anatomy, edges, framing, palette and unwanted text.
5. **Correct** a failed asset once with a sharper brief, passing its asset ID in referenceAssetIds; never generate a series of guesses.
6. **Attach** it as scene media (scene-engine, Project media) and place it (Example).

## Rules

### Prompt
- Give seven concrete items: medium and format, one reference era or discipline, composition and framing, lighting, 2–4 named colours, texture and material, exclusions.
- Use the film's actual palette for backgrounds, textures and image fills.
- Add "no text, no lettering, no logos" for assets that need none; set final type in code.
- An isolated subject keeps room around its silhouette. A texture or backdrop states its coverage and crop.
- A texture states its material, scale and seamless coverage; inspect the seams before repeating it.
- An environment-map plate asks for a panoramic reflection and lighting reference; inspect its projection.

### Format
- Use transparentBackground: true for a subject composited over a film. Ask for no background or floor, and keep the whole silhouette in frame.
- Use an opaque plate (the default) for a photo, texture or background.
- For an edit or variation, say what to preserve and exactly what to change.

### Banned unless requested
- Neon or glow, glassmorphism, purple or blue gradients, bright purple fills, glowing orbs, lens flares, sparkles, holograms, stock futuristic decoration, AI-looking skin.
- A muted grain gradient is allowed as an image fill when the user asks for it. Film backgrounds follow page `backgrounds`.

### Recreations
- A reference supplies framing, palette, material and motion observations. Describe a fresh subject or material from them.
- Never generate, edit or upload reproductions of its frames, whole compositions, UI or typography, and never pass an extracted reference frame as a reference image.
- Rebuild those layers in code and generate only the assets they need.

### Placement
- Give the `<img>` explicit width and height and `object-fit: contain`.
- Keep text, shapes and backgrounds as separate scene elements.

## Example
Opaque plate: "Studio product photograph, 1980s industrial-design catalogue. One retro beige desktop computer, three-quarter front view, complete monitor and keyboard centered with generous margins. Ivory, charcoal and warm grey; matte aged plastic and fine 35mm grain. Large softbox above left, solid cream background, blank dark screen. No text, lettering, logos, flares or extra objects."

Cut-out (transparentBackground: true): "35mm studio close-up, documentary still-life discipline. One adult hand holding a blank ivory card, wrist entering from below, three-quarter front view, whole silhouette with generous clear margins. Natural umber, ivory and warm grey; real skin creases, matte paper, subtle grain. Broad soft side light, transparent background. No floor, backdrop, text, lettering, logos, jewelry or beauty retouching."

```ts
// attached as media: [{ name: 'hand', assetId: '<returned assetId>' }]
root.insertAdjacentHTML('beforeend', `<img class="hand" src="${media.hand}" style="position:absolute;left:55%;top:30%;width:520px;height:520px;object-fit:contain">`);
```
