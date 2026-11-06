---
name: "image-plates"
description: "Assets on demand: choose code, icons, traced shapes before generating subjects, textures, backgrounds and cut-outs."
---
# Image plates

During a build, use generateImage on demand for a photoreal subject, texture, background plate or transparent cut-out. The tool saves PNGs directly into project media and returns assetIds, signed assets[].url links, previews, quality and estimatedUsd (null means the provider did not report enough usage to estimate it). Each variant costs image tokens; start with one and request alternatives only when useful. Assets default to medium quality; low is cheaper for exploration. A failed call includes its actual cause; correct invalid input or unavailable access before trying again.

## Decision order
1. Brand logos and app icons: findIcon returns the real artwork. Hand-made shapes from a reference: traceShape, then use its paths.
2. Anything that reads better as built type, vector or GSAP motion: build it in HTML/CSS/SVG and scene code. Keep UI, cards, gradients, borders and editable graphics as code.
3. Otherwise use generateImage: photoreal or illustrated hands, physical objects, products, photos, textures, backgrounds and cut-outs. For an isolated subject, preserve room around its silhouette; for a texture or backdrop, describe its intended coverage and crop.

A reference video supplies framing, palette, material and motion observations. Describe a fresh subject or material from those observations. Never generate, edit or upload reproductions of its frames, whole compositions, UI or typography, and never use an extracted reference-video frame as a reference image. Rebuild those layers in code and generate only the assets they need.

## Prompt and generate
Give SEVEN concrete prompt items: medium/format, one reference era/discipline, composition/framing, lighting, 2–4 named colours, texture/material and exclusions. Example: "Studio product photograph; 1980s catalogue; one complete beige CRT, three-quarter view; broad softbox left; ivory, charcoal, warm grey; matte plastic and fine grain; no text, logos, flares or extra objects." Use the film's actual palette for backgrounds, textures and image fills.
Reject unrequested neon/glow, glassmorphism, purple/blue gradients, bright purple fills, glowing orbs, lens flares, sparkles, holograms, stock futuristic decoration and AI-looking skin. A muted grain gradient is allowed as an image fill when the user asks for it; film backgrounds follow page `backgrounds`. Inspect each preview; correct one failed asset with a sharper brief rather than generating a series of guesses.
1. Describe one useful asset: subject or surface, pose/orientation, camera and framing, palette, material, lighting and intended use. Include "no text, no lettering, no logos" for assets that need none; add final type in code. For a texture, ask for the needed material, scale and seamless/tileable coverage; inspect seams before repeating it. For an environment-map plate, describe a panoramic reflection/lighting reference and inspect its projection; it remains a PNG.
2. Choose aspectRatio (1:1, 3:2, 2:3, 16:9, 9:16, 4:5, 4:3 or 2:1) OR size. Assets default to square. Use transparentBackground: true for a subject to composite over a scene; false for an opaque photo, texture or background plate. Ask for no background or floor for a cut-out, and keep the complete silhouette inside the frame.
3. For an edit or variation, pass referenceAssetIds containing existing project PNG/JPEG/WebP image IDs. Say what to preserve and exactly what to change. A transparent edit must still set transparentBackground: true. Up to four subject references and count 1 to 4 variants are supported.
4. Inspect the returned previews: subject, anatomy, edges, framing, palette and unwanted text. Use the returned asset ID as a reference for a precise correction when needed. Prompt and model provenance stay with the saved media.

Opaque example: "Studio product photograph, 1980s industrial-design catalogue. One retro beige desktop computer, three-quarter front view, complete monitor and keyboard centered with generous margins. Ivory, charcoal and warm grey; matte aged plastic and fine 35mm grain. Large softbox above left, solid cream background, blank dark screen. No text, lettering, logos, flares or extra objects."

Cut-out example: "35mm studio close-up, documentary still-life discipline. One adult hand holding a blank ivory card, wrist entering from below, three-quarter front view, whole silhouette with generous clear margins. Natural umber, ivory and warm grey; real skin creases, matte paper, subtle grain. Broad soft side light, transparent background. No floor, backdrop, text, lettering, logos, jewelry or beauty retouching."

## Bind
Attach the chosen asset to addScene/addFilm or editScene as media: [{ name: 'hand', assetId: '<returned assetId>' }]. In scene HTML use `<img src="${media.hand}">` with explicit width/height and object-fit: contain. Keep text, shapes and backgrounds as separate scene elements.
