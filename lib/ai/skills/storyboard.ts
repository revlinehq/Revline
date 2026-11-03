import type { EditorSkill } from './index';

export const storyboard: EditorSkill = {
  name: 'storyboard',
  description: 'Before any motion design from scratch: understand the brief, brainstorm two contrasting looks, develop 3–6 consistent rough key frames, iterate with the user and save the approved handoff. Skip small edits and just build it.',
  body: `# Storyboard: the brain of the film

Run this BEFORE scene code for any motion design from scratch. Agent and user brainstorm together and settle on rough looks first: a taste before eating, not an unreviewed full build. Skip the whole flow for small edits to existing work and when the user says "just build it". If this project's approved storyboard already covers the current request, read it with readBrief and continue from its handoff instead of restarting.

## 1. Understand before asking
Pull what is already known from the user's message, getProject/readBrief, project media, listBrandKits and the matching getBrandKit. Read any supplied site URL: use the client's web reader or Revline's createBrandKit with url to read its real copy, colors and assets. A URL's name is not evidence of what the product does. Review uploaded logos, app screens, photography and footage before deciding what is missing.

Then ask at most TWO OR THREE questions in ONE message, only for missing information, with sensible defaults. Combine topics rather than interrogating one at a time:
- Goal (general motion piece or product/startup launch), what the product is/does and the audience.
- Platform/aspect ratio and rough length (offer the project's current format and a short length when unspecified).
- Music/voiceover and ending/CTA (offer a restrained instrumental, no voiceover and a simple confirmed CTA when suitable).

Ask for the real logo and app screenshots in that same message when needed. Real product UI beats invented UI. Use available real screens; if none can be had, agree on an abstract representation or ask for them. Never fabricate the product's interface, features, claims, prices or website. Do not ask the user to repeat facts already present. Save the agreed understanding in the project brief when it will guide later sessions.

## 2. Offer two contrasting directions
Generate ONE frame for each of two genuinely different looks, using generateImage with purpose: "storyboard" and storyboard: { name, phase: "direction", shotIndex: 1 or 2, idea, visual, onScreenText, motion, transition, assetsNeeded }. Reuse the same board name throughout this film. Choose sketch/drawing or rough real visuals according to what communicates the idea best. Vary composition/material/color or visual metaphor, not just a tiny tint.

Use GPT Image 2.5 Flare, quality: "low" (default for storyboards), or medium if roughness hides the idea. Use the target aspectRatio; omission follows the selected timeline. Show the two generated images ONLY in chat/composer, numbered 1 and 2. Do not add prose descriptions or a shot table beside them. In-app, the numbered image grid above EditComposer shows them; use askUser with two concise direction choices and END THE TURN. Over MCP, show the returned images and ask for the pick in that client's chat. Wait for the user's actual choice.

## 3. Develop the board
Generate 3–6 key frames in the chosen direction. Use purpose: "storyboard", phase: "board", one call per shot, count: 1 and the same board name. Pass the chosen direction image as a reference for frame 1. Frame 1 is then the STYLE ANCHOR: include its assetId in referenceAssetIds for every later frame, together with the brand colors in each prompt. Keep one aspect ratio and a consistent palette, material, lighting, type hierarchy and image treatment across the board. Keep in-image text rough; the real on-screen text is saved in the shot notes and built as live type later.

Each shot's metadata holds idea, visual, onScreenText, motion, transition and assetsNeeded. Motion and transition are PLAIN WORDS, not seconds or code: "headline fades up", "cards spin in and stack", "logo snaps in on the beat", "the top card expands into the next shot". A rough overall length belongs in the agreed context, not in these motion notes.

Every frame must show something the scene engine can actually build. Read scene-engine (react-scenes and checklist), GSAP's revline page and, for 3D, three-scenes and three-craft before promising the look. Use buildable GSAP/HTML layers, three.js primitives/extrusions and generated plates as assets. Do not promise unsupported refraction, shadows, environment loading or effects merely because an image model can paint them. Follow motion-design page image-plates for the on-demand asset decision order.

Frames are project REFERENCE media, with a shared name and frame number; getProject and inspectTimeline expose their shot notes and cost. They never go on the timeline, and they are never bound into the finished film as a screenshot of the whole design. The chat grid displays images and frame numbers only. Keep motion notes and transitions in metadata rather than turning the image review into a prose presentation. Show the board, ask for OK or edits, then END THE TURN. A successful generation is not approval.

## 4. Iterate cheaply
"Change frame 3" regenerates ONLY frame 3 with the same name, phase and shotIndex, using frame 1 as its style reference. Keep the other approved images and their IDs. The grid uses the newest image at each frame number. Show the changed board and wait for approval again. A broad new direction may need a new anchor, but do not quietly regenerate unaffected shots. Costs stay visible in generateImage's estimatedUsd and usage result; low/medium keeps exploration cheap. null estimatedUsd means the provider did not report enough usage for an estimate.

## 5. Save the approved handoff
Only on the user's OK, call saveStoryboard with the name, chosen direction description and directionAssetId, agreed context, target aspectRatio, the latest approved frameAssetIds (3–6), approved: true and approvalNote quoting the user. Frame 1 becomes styleAnchorAssetId. The tool saves the structured storyboard beside the project brief without replacing its existing rules. It includes every shot's idea, visual, on-screen text, plain-word motion, transition and assets needed. readBrief, getProject and inspectTimeline return it; later sessions read it before building.

## 6. Hand off to motion design
After the approved handoff is saved, load motion-design and build editable scene code, GSAP motion, supported three.js geometry and separately sourced/generated assets. Board images remain look references. A plate inside a scene is an asset generated on demand, not a whole storyboard frame pasted over the code.

At the end, read each board frame with readFrames { assetId, start: 0, end: 0, count: 1 }, and compare the built shot with compareReference { assetId, times: [the key moment in the timeline] }, passing the same timelineId as the build. A still reference stays fixed while the timeline is sampled. Judge composition, palette, hierarchy, materials and intent, not pixel tracing or a score threshold. Use getFrames around the start/key/settle and checkPacing for the actual motion; a still image cannot prove motion.

For a supplied reference video, keep using reference-footage's observation/recreation workflow. Never feed extracted video frames into image generation or generate reproductions of its frames. New storyboard imagery communicates buildable intent; measured reference behavior still governs a requested recreation.
`,
};
