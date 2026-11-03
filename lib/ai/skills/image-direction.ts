import type { EditorSkill } from './index';

export const imageDirection: EditorSkill = {
  name: 'image-direction',
  description: 'Before every generateImage call: write a seven-part brief, draw the actual shot in black ink for boards, and check objects and lettering before presenting.',
  body: `# Image direction

## Every image call
1. Read this skill before generateImage. Use the user's supplied style or brand kit; otherwise state one look at sketching time, for example "Look: black ink and cross-hatching, with colour added in the style frames." Do not ask for a separate style pick.
2. Put seven items in the prompt: medium, one reference discipline/era, composition and camera angle, lighting, palette, texture, exclusions. Example for a plate: "Studio product photograph; 1980s catalogue; one complete beige CRT, three-quarter view; broad softbox left; ivory, charcoal, warm grey; matte plastic and fine grain; no text, logos, flares or extra objects."
3. Use 2–4 named colours for final-look images. Use only black ink and white paper for rough boards: zero colour and zero accent colour. For cut-outs set transparentBackground: true and request a complete silhouette with margins, no floor or backdrop. Asset plates without words say "no text, no lettering, no logos"; boards draw the exact onScreenText instead.

## Rough-board preset
4. Draw one complete black-ink illustration of the ACTUAL final shot. Match its objects, object count, composition, camera angle and exact on-screen words. Examples: a pawn hitting a king; a trophy above "Stay IRREPLACEABLE"; a CRT reading "GENERATING YOUR IMAGE 52%"; hands reaching for a card. Each object must be recognisable without a label. Use zero blank placeholder boxes, placeholder lines or "A BIG HEADLINE" substitutions.
5. Use clean ink contours and cross-hatching for shading on white paper, with a few light diagonal pencil strokes behind the subject. Use zero frame borders, shot numbers, arrows, IN/OUT times or handwritten production notes inside the image. Put shotIndex, duration and motion in metadata and the reply caption. This replaces the previous pencil thumbnail, green underline and annotation preset.
6. Set aspectRatio to the film's format: 9:16 for a portrait Reel, 16:9 for landscape. Generate first and last frames before the middle; pass frame 1 in referenceAssetIds for every later rough frame. Reuse its pen, hatching and paper, while drawing each shot's own objects and copy.
7. The 8 supplied @hc.prath breakdowns show trophies, chess pieces, photo cards, CRTs and hands drawn before colour. Apply their clean contours and hatching to this project's actual subjects. Generate zero copies of those reference-video frames.

| Bad Shot 1 | Good Shot 1 |
| --- | --- |
| An abstract "A BIG HEADLINE" and green underline, with blank boxes. | A fully drawn keyboard, typing fingers and monitor showing the actual composer and timeline; the real line "Edit your video with a sentence" is lettered in its final position. Black contours and cross-hatching; no green underline or planning marks. |

## Final look and assets
8. Render only 2–3 style frames after the user approves the rough board. Pass the first style frame as a reference for the others. For an approved hand-drawn finish, use the Terra study DfMzGyNBdUH recipe: SVG stroke drawing with DrawSVG/stroke-dashoffset on the GSAP clock, one fixed paper texture, and separate hand-drawn plates animated as layers. Check scene-engine react-scenes/checklist and gsap revline before promising the shot.
9. Follow motion-design page image-plates before generating an asset: findIcon for logos/app icons, traceShape for hand-made shapes, code for type/vector/GSAP, three.js for primitives/extrusions. Use <Model> only for a user-supplied GLB. Generate textures, environment-map plates, photos or cut-outs after those checks.

## Check before presenting
10. Inspect every returned preview. For a rough frame ask exactly: "Could the final frame be built by colouring this sketch? If not, regenerate." Match each object and every word against visual/onScreenText at full size. A missing hand, wrong camera angle, blank box, substitute headline, colour or planning annotation fails this check. Regenerate that frame once with the specific correction; if it still fails, show the issue in one sentence and stop for the user.
11. Reject these items unless the user explicitly requested the specific item: neon/glow lines, glassmorphism, purple-to-lime or purple/blue gradients, floating 3D UI cards, lens flares, bokeh orbs, sparkles, holograms, generic smiling stock people, sunset-mountain hero shots, "futuristic" decoration and AI-looking skin. Check against the user's recorded verdicts: liked isometric line diagrams and muted film-grain gradients; disliked bright purple fills, sparkles and cheap cursors. An explicit newer request wins.
12. Call presentStoryboard only after the visual check. This publishes review images, not user approval. Over MCP embed each frames[].url as ![Shot N](url), one per line, with a caption of at most 12 words. Use generateImage assets[].url for an asset preview. Report estimatedUsd from the tool; null means unknown. Make zero approval writes until the user actually approves.

## Bad → good prompt examples
13. Bad: "Cinematic futuristic startup storyboard, purple neon." Good: "Black-ink storyboard illustration, commercial storyboard discipline. Portrait 9:16, three-quarter view of a keyboard, typing fingers and monitor with the real supplied editor screenshot. Letter 'Edit your video with a sentence' above it. Flat paper light; black and white only; clean contours, cross-hatching and a few light diagonal pencil strokes. No border, arrows, numbers, notes, colour or invented UI."
14. Bad: "Woman holding a card, beautiful skin, sunset." Good: "35mm studio close-up, documentary still-life discipline. One adult hand holds a blank card, wrist entering below, complete silhouette with margins. Broad soft side light; natural umber, ivory, warm grey; real skin creases and subtle grain. Transparent cut-out. No floor, scenery, face, lettering, jewellery or beauty retouching."
`,
};
