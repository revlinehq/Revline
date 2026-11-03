import type { EditorSkillPage } from '../index';

export const imagePlatesPage: EditorSkillPage = {
  name: 'image-plates',
  description: 'Assets on demand: choose code, icons, traced shapes or three.js before generating subjects, textures, environment maps, backgrounds and cut-outs. New films start with the dedicated storyboard skill.',
  body: `# Image plates

For a new launch film or standalone motion piece, read the standalone storyboard skill BEFORE scene code: agree on the brief and text concepts before any image, then approve hand-drawn rough sketches, final-look style frames and a paced animatic. Skip that planning stop for small edits and "just build it".

During a build, use generateImage on demand for a photoreal subject, texture, environment map, background plate or transparent cut-out. purpose: "asset" is the default and keeps existing asset calls working. The tool saves PNGs directly into project media and returns assetIds, previews, quality and estimatedUsd (null means the provider did not report enough usage to estimate it). Each variant costs image tokens; start with one and request alternatives only when useful. Assets default to medium quality; low is cheaper for exploration. A failed call includes its actual cause; correct invalid input or unavailable access before trying again.

## Decision order
1. Brand logos and app icons: findIcon returns the real artwork. Hand-made shapes from a reference: traceShape, then use its paths.
2. Anything that reads better as built type, vector or GSAP motion: build it in HTML/CSS/SVG and scene code. Keep UI, cards, gradients, borders and editable graphics as code.
3. 3D: build it in three.js with primitives and extrusions; read scene-engine pages three-scenes and three-craft. Use a GLB via uploadMedia and <Model> only when the USER supplies one. generateImage can supply texture, environment-map and background plates for a 3D scene; it does not produce geometry. A generated environment-map image is a 2D PNG, not an HDR lighting rig. Follow three-scenes/three-craft for supported texture loading and renderer limits; do not invent an unsupported environment loader.
4. Otherwise use generateImage: photoreal or illustrated hands, physical objects, products, photos, textures, backgrounds and cut-outs. For an isolated subject, preserve room around its silhouette; for a texture or backdrop, describe its intended coverage and crop.

A reference video supplies framing, palette, material and motion observations. Describe a fresh subject or material from those observations. Never generate, edit or upload reproductions of its frames, whole compositions, UI or typography, and never use an extracted reference-video frame as a reference image. Rebuild those layers in code and generate only the assets they need. Image-to-3D generation is a possible future capability, not an available tool.

## Prompt and generate
ReadSkill name "image-direction" before EVERY generateImage call: medium, one reference era/discipline, composition, lighting, 2–4 named colors, texture and exclusions. Follow its banned-by-default list and inspect each result before using it; reject a failure and regenerate once with a sharper brief.
1. Describe one useful asset: subject or surface, pose/orientation, camera and framing, palette, material, lighting and intended use. Include "no text, no lettering, no logos" for assets that need none; add final type in code. For a texture, ask for the needed material, scale and seamless/tileable coverage; inspect seams before repeating it. For an environment-map plate, describe a panoramic reflection/lighting reference and inspect its projection; it remains a PNG.
2. Choose aspectRatio (1:1, 3:2, 2:3, 16:9, 9:16, 4:5, 4:3 or 2:1) OR size. Assets default to square. Use transparentBackground: true for a subject to composite over a scene; false for an opaque photo, texture or background plate. Ask for no background or floor for a cut-out, and keep the complete silhouette inside the frame.
3. For an edit or variation, pass referenceAssetIds containing existing project PNG/JPEG/WebP image IDs. Say what to preserve and exactly what to change. A transparent edit must still set transparentBackground: true. Up to four subject references and count 1 to 4 variants are supported.
4. Inspect the returned previews: subject, anatomy, edges, framing, palette and unwanted text. Use the returned asset ID as a reference for a precise correction when needed. Prompt and model provenance stay with the saved media.

Opaque example: "Studio product photograph, 1980s industrial-design catalogue. One retro beige desktop computer, three-quarter front view, complete monitor and keyboard centered with generous margins. Ivory, charcoal and warm grey; matte aged plastic and fine 35mm grain. Large softbox above left, solid cream background, blank dark screen. No text, lettering, logos, flares or extra objects."

Cut-out example: "35mm studio close-up, documentary still-life discipline. One adult hand holding a blank ivory card, wrist entering from below, three-quarter front view, whole silhouette with generous clear margins. Natural umber, ivory and warm grey; real skin creases, matte paper, subtle grain. Broad soft side light, transparent background. No floor, backdrop, text, lettering, logos, jewelry or beauty retouching."

## Bind and animate
Read scene-engine page react-scenes and gsap page revline. Attach the chosen asset to addScene/addFilm or editScene as media: [{ name: 'hand', assetId: '<returned assetId>' }]. In scene HTML use an img whose src is media.hand, with explicit width/height and object-fit: contain. Keep text, shapes and backgrounds as separate scene elements.

Give the plate a wrapper and animate that wrapper on the scene's GSAP timeline: translation for an entrance, rotation around the wrist or object's contact point, scale for camera framing, clip-path for a reveal, or a masked crop. Set transform-origin to the physical pivot. Animate an outer camera wrapper for a shared push or pan; animate the plate's own wrapper for independent movement. A single plate has one fixed pose: wrapper motion does not articulate fingers or change an object's viewpoint. Use a separately generated pose only for an intentional cut or replacement.

All motion uses the scene clock and GSAP, so seeking, preview and export agree. Inspect rendered key beats with getFrames; for a recreation compare the composed scene with compareReference and compareMotion. Finish when the subject and its edges composite correctly and its motion matches the intended beat.
`,
};
