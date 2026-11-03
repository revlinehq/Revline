import type { EditorSkill } from './index';

export const imageDirection: EditorSkill = {
  name: 'image-direction',
  description: 'Before every generateImage call: write a seven-part brief, draw readable ink sheets and full-size key frames, and check objects and lettering before presenting.',
  body: `# Image direction

## Every image call
1. Read this skill before generateImage. Use the user's supplied style or brand kit; otherwise state one look at sketching time, for example "Look: black ink and cross-hatching, with colour added in the style frames." Do not ask for a separate style pick.
2. Put seven items in the prompt: medium, one reference discipline/era, composition and camera angle, lighting, palette, texture, exclusions. Example for a plate: "Studio product photograph; 1980s catalogue; one complete beige CRT, three-quarter view; broad softbox left; ivory, charcoal, warm grey; matte plastic and fine grain; no text, logos, flares or extra objects."
3. Use 2–4 named colours for final-look images. Use only black ink and white paper for rough boards: zero colour and zero accent colour. For cut-outs set transparentBackground: true and request a complete silhouette with margins, no floor or backdrop. Asset plates without words say "no text, no lettering, no logos"; boards draw the exact onScreenText instead.

## Rough-board preset
4. Draw one complete black-ink illustration of the ACTUAL final shot. Match its objects, object count, composition, camera angle and exact on-screen words. Examples: a pawn hitting a king; a trophy above "Stay IRREPLACEABLE"; a CRT reading "GENERATING YOUR IMAGE 52%"; hands reaching for a card. Each object must be recognisable without a label. Use zero blank placeholder boxes, placeholder lines or "A BIG HEADLINE" substitutions.
5. Use clean ink contours and cross-hatching for shading on white paper, with a few light diagonal pencil strokes behind the subject. For a full-size frame use zero borders, shot numbers, arrows, IN/OUT times or production notes. A SHEET uses thin gutters/panel edges, small panel numbers and A/B row labels only; zero other annotations. Put duration, motion and transitions in panel metadata, not in the drawing.
6. Every panel keeps the film's ratio: 9:16 for a portrait Reel, 16:9 for landscape. For sheets, set sheet.panelAspectRatio to that format and let generateImage choose the whole page size; margins preserve each panel's ratio. Check storyboard's grid-size table: combined A/B is ONE image with 2 rows of 2–3 panels, A above B; longer choices use separate pages of at most 8 panels. Reuse the same pen/hatching/paper. A key-frame redraw uses the film aspectRatio and the chosen sheet in referenceAssetIds.
7. The 8 supplied @hc.prath breakdowns show trophies, chess pieces, photo cards, CRTs and hands drawn before colour. Apply their clean contours and hatching to this project's actual subjects. Generate zero copies of those reference-video frames.

| Bad Shot 1 | Good Shot 1 |
| --- | --- |
| An abstract "A BIG HEADLINE" and green underline, with blank boxes. | A fully drawn keyboard, typing fingers and monitor showing the actual composer and timeline; the real line "Edit your video with a sentence" is lettered in its final position. Black contours and cross-hatching; no green underline or planning marks. |

## Sheet prompt template
8. Use ONE generateImage call with phase: "sheet", quality: "low", count: 1 for a 2–3-beat A/B choice. More than 3 beats per option uses separate sheets; storyboard's table sets the grid for the length. Example template for a combined portrait Reel page (columns: 3, rows: 2):

"ONE commercial storyboard page in the @hc.prath ink discipline. Six panels, three columns × two rows, read left to right. Row A above row B; each panel portrait 9:16. Thin white gutters; centre the grid with white outer margins. Flat paper light. Black ink and white only; clean contours, cross-hatching, a few light diagonal pencil strokes. Each panel fully draws its actual final objects and exact words. Only small A/B row labels and panel numbers outside drawings. No arrows, motion notes, captions, colour, glow, placeholder boxes or invented UI.
A1 — Seven fully drawn editing desks recede down a museum hall; letter 'Seven years. Same timeline.'
A2 — The eighth desk shows the supplied real timeline with one fixed manual cut; letter 'This cut stays.'
A3 — The same desk plays the changed real edit; letter 'Editing, finally different.'
B1 — Seven boxed editing displays repeat the same trim, viewed straight on; letter 'Seven years. Same timeline.'
B2 — One boxed display opens onto the supplied real timeline; letter 'This cut stays.'
B3 — The opened display fills the view with the changed edit; letter 'Editing, finally different.'"

9. Put each line's exact subject/copy in sheet.panels[].visual/onScreenText too; record direction, row, column and consecutive shotIndex per direction. Use the actual approved proof and supplied screen rather than copying the museum example into unrelated projects. Inspect each panel with "Could the final frame be built by colouring this sketch? If not, regenerate." For >40 s use multiple pages of at most 8 panels each, continuing the direction's shotIndex across sheets.

## Final look and assets
10. After the user picks the sheet direction, render only 2–3 full-size key frames, phase style, in the final look. Reference the chosen sheet in EVERY redraw, retaining the panel's objects, camera and exact words. Then stop for their review. For an approved hand-drawn finish, use the Terra study DfMzGyNBdUH recipe: SVG stroke drawing with DrawSVG/stroke-dashoffset on the GSAP clock, one fixed paper texture, and separate hand-drawn plates animated as layers. Check scene-engine react-scenes/checklist and gsap revline before promising the shot.
11. Follow motion-design page image-plates before generating an asset: findIcon for logos/app icons, traceShape for hand-made shapes, code for type/vector/GSAP, three.js for primitives/extrusions. Use <Model> only for a user-supplied GLB. Generate textures, environment-map plates, photos or cut-outs after those checks.

## Check before presenting
12. Inspect every returned preview. For EVERY sheet panel and full-size rough frame ask exactly: "Could the final frame be built by colouring this sketch? If not, regenerate." Match each object and every word against visual/onScreenText at full size. A missing hand, wrong camera angle, blank box, substitute headline, colour or extra planning annotation fails this check. Only sheet panel numbers/A/B labels are allowed outside drawings. Regenerate only the failed sheet or key frame once with the specific correction; if it still fails, show the issue in one sentence and stop for the user.
13. Reject these items unless the user explicitly requested the specific item: neon/glow lines, glassmorphism, purple-to-lime or purple/blue gradients, floating 3D UI cards, lens flares, bokeh orbs, sparkles, holograms, generic smiling stock people, sunset-mountain hero shots, "futuristic" decoration and AI-looking skin. Check against the user's recorded verdicts: liked isometric line diagrams and muted film-grain gradients; disliked bright purple fills, sparkles and cheap cursors. An explicit newer request wins.
14. Call presentStoryboard only after the visual check. This publishes review images, not user approval. Over MCP embed each signed frames[].url as ![A/B sketch sheet](url), ![Direction A](url) or ![Shot N](url), one per line. Give each direction a caption of at most 12 words and a Hooks because line of at most 15 words. Use generateImage assets[].url for an asset preview. Report estimatedUsd from the tool; null means unknown. Make zero approval writes until the user actually approves.

## Bad → good prompt examples
15. Bad: "Cinematic futuristic startup storyboard, purple neon." Good: "Black-ink storyboard illustration, commercial storyboard discipline. Portrait 9:16, three-quarter view of a keyboard, typing fingers and monitor with the real supplied editor screenshot. Letter 'Edit your video with a sentence' above it. Flat paper light; black and white only; clean contours, cross-hatching and a few light diagonal pencil strokes. No border, arrows, numbers, notes, colour or invented UI."
16. Bad: "Woman holding a card, beautiful skin, sunset." Good: "35mm studio close-up, documentary still-life discipline. One adult hand holds a blank card, wrist entering below, complete silhouette with margins. Broad soft side light; natural umber, ivory, warm grey; real skin creases and subtle grain. Transparent cut-out. No floor, scenery, face, lettering, jewellery or beauty retouching."
`,
};
