import type { EditorSkillPage } from '../index';

export const imagePlatesPage: EditorSkillPage = {
  name: 'image-plates',
  description: 'Generate isolated photoreal or illustrative subjects (hands, objects, products, photos) as project media, then animate them with GSAP. Also covers transparent cut-outs and edits from project images.',
  body: `# Image plates

Use generateImage when the scene needs a photoreal or illustrative subject code cannot draw well: a hand holding a blank card, a pointing finger, a retro computer, a photo card, or glass chess pieces. The tool saves PNG assets directly into project media and returns their assetIds and previews. Each variant costs a provider call's image tokens; start with one and request more only when alternatives are useful. A generation can take several minutes. A failed call includes its actual cause; correct invalid input or unavailable access before trying again.

## Choose the source
- Logos and brand/UI icons: findIcon returns the real artwork.
- Hand-made shapes from a reference: traceShape, then use the returned paths.
- Type, UI, cards, geometric shapes, gradients, borders and anything HTML/CSS/SVG can draw: build in scene code so it stays editable.
- Hands, physical objects, products and photographs: generate an isolated plate, then compose it with code.
- A reference video supplies framing, palette, material and motion measurements. Describe a fresh isolated subject from those observations. Never generate, edit or upload a reproduction of its frames, whole compositions, UI or typography; never use an extracted reference-video frame as a reference image. Rebuild those layers in code and use plates only for the subjects that need them.

## Prompt and generate
1. Describe ONE isolated subject: what it is, its pose or orientation, camera angle and framing, palette, material, lighting and clear space around its edges. Include "no text, no lettering, no logos". Add the scene's real text as HTML later.
2. Choose aspectRatio (1:1, 3:2, 2:3, 16:9 or 9:16) OR size. Square is a good default for a cut-out. Use transparentBackground: true for a subject to composite over a scene; false for an opaque photo plate. Ask for no background or floor for a cut-out, and keep the complete silhouette inside the frame.
3. For an edit or variation, pass referenceAssetIds containing existing project PNG/JPEG/WebP image IDs. Say what to preserve and exactly what to change. A transparent edit must still set transparentBackground: true. Up to four subject references and count 1 to 4 variants are supported.
4. Inspect the returned previews: subject, anatomy, edges, framing, palette and unwanted text. Use the returned asset ID as a reference for a precise correction when needed. Prompt and model provenance stay with the saved media.

Opaque example: "One isolated retro beige desktop computer, three-quarter front view, complete monitor and keyboard centered with generous margins, warm ivory and charcoal palette, matte aged plastic, soft studio light on a solid cream background, blank dark screen, no text, no lettering, no logos."

Cut-out example: "One adult hand holding a blank ivory card between thumb and fingers, wrist entering from the bottom, three-quarter front view, whole hand and card inside the frame with generous clear margins, warm natural skin and matte paper, soft studio light, transparent background, no floor or backdrop, no text, no lettering, no logos."

## Bind and animate
Read scene-engine page react-scenes and gsap page revline. Attach the chosen asset to addScene/addFilm or editScene as media: [{ name: 'hand', assetId: '<returned assetId>' }]. In scene HTML use an img whose src is media.hand, with explicit width/height and object-fit: contain. Keep text, shapes and backgrounds as separate scene elements.

Give the plate a wrapper and animate that wrapper on the scene's GSAP timeline: translation for an entrance, rotation around the wrist or object's contact point, scale for camera framing, clip-path for a reveal, or a masked crop. Set transform-origin to the physical pivot. Animate an outer camera wrapper for a shared push or pan; animate the plate's own wrapper for independent movement. A single plate has one fixed pose: wrapper motion does not articulate fingers or change an object's viewpoint. Use a separately generated pose only for an intentional cut or replacement.

All motion uses the scene clock and GSAP, so seeking, preview and export agree. Inspect rendered key beats with getFrames; for a recreation compare the composed scene with compareReference and compareMotion. Finish when the subject and its edges composite correctly and its motion matches the intended beat.
`,
};
