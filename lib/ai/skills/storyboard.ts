import type { EditorSkill } from './index';

export const storyboard: EditorSkill = {
  name: 'storyboard',
  description: 'Before motion design from scratch: brief, text concepts, hand-drawn rough board, final-look style frames, paced animatic, then build. Each stage waits for the user. Skip small edits and just build it.',
  body: `# Storyboard: the brain of the film

Run before motion design from scratch. Plan with the user so they get a taste before the build. Skip the whole flow for small edits or when the user says "just build it". Read readBrief first: resume the saved stage rather than restarting. Each stage ends with the user's OK; END THE TURN at that stop. Tool success, silence and your own visual review are not approval.

## 1. Brief
Read the message, inspectTimeline/readBrief, uploaded assets and matching brand kit first. Read a supplied site URL with createBrandKit { url }; learn what the product actually does. In ONE short message ask at most 2–3 questions, only for missing facts, with sensible defaults: who it is for, what it is, why it matters, platform/aspect ratio, length, audio and CTA. Ask for the real logo and product screens in the same message when needed. Real UI beats invented UI: use the supplied screens, or agree to an abstract diagram when screens cannot be had. Never invent the product's interface or claims.

End with a one-sentence promise of the film. Save lasting facts with updateBrief and wait for the brief's OK.

## 2. Ideas first — no images
Offer TWO concepts that differ in idea, story and composition, not just color; optionally a third wildcard. Use short, scannable text, familiar words and this format for each:
- Name and one-line idea.
- What you'll see: 4–6 one-line shot beats.
- Look: one light hint, not a style selection exercise.
- Motion: how things move, in one line.
- Why it works for you: one line.

For a launch use promise → old way/problem → reveal → three proof moments → CTA that also works as a thumbnail. Group the three proof moments in one beat when needed to keep 4–6 beats. Product claims must come from the agreed brief.

Iterate in text: the user can mix one concept's story with the other's look, change beats or reject both. Revise the words cheaply. Generate NO images until the user picks an idea. End with ONE question: which concept, or what should change? On their choice, saveStoryboard stage: "concept", with both concepts, chosenConcept (1-based), promise, context, aspectRatio and approved: true; quote their choice in approvalNote.

### Example message (after the brief is agreed)
**A — Make room**
One idea: a crowded day opens into one clear plan.
What you'll see:
- A clear space promises a calmer working day.
- Message scraps crowd that space: the old way.
- Relay gathers them into one simple plan.
- Three agreed benefits appear as three clean diagram steps.
- "Make room for focus" closes on a frame that also works as the thumbnail.
Look: a quiet paper-and-ink hint.
Motion: loose pieces gather, align and leave room around the final message.
Why it works for you: busy small teams see the benefit before the details.

**B — Pass it on**
One idea: follow a single task from a noisy handoff to a clear next step.
What you'll see:
- One task promises a smoother handoff.
- It gets passed through a tangle of message threads.
- Relay turns the tangle into a clear route.
- Three agreed benefits become three stops along that route.
- The route ends at "Make room for focus", held as the thumbnail.
Look: a simple route-diagram hint.
Motion: one mark travels through the story and carries us between shots.
Why it works for you: a concrete journey makes the product easy to explain.

Which idea should we develop, or what would you change?

## 3. Rough board: hand-drawn thumbnails
Honor the user's style, brand kit or reference if supplied. Otherwise choose the final visual direction yourself from the concept and your taste at sketching time; do not ask the user to pick a style. With the sketches state ONE line: "Look: …, because …". The user can override it. Read image-direction before every generateImage call, including its hand-drawn storyboard preset.

Draw 3–6 rough frames, one per shot, at the target aspect ratio. Draw FIRST and LAST first, then fill the middle. Use purpose: "storyboard", quality: "low" (medium only if needed), count: 1, and storyboard { name, phase: "rough", shotIndex, idea, visual, onScreenText, motion, transition, assetsNeeded }. Reuse one board name. Pass frame 1's assetId in referenceAssetIds for ALL later rough frames, including the last. Same paper, pen and hand throughout.

Use pencil or fineliner on off-white paper, loose construction lines, light grey marker shading and at most one accent marker. Include a hand-drawn panel border and shot number, motion arrows/speed lines, camera arrows and small IN/OUT notes. Keep handwritten labels minimal. They must look rough on purpose: never polished, 3D-rendered or glowing. Store accurate text in onScreenText for live type later.

Each shot has plain motion notes ("headline fades up", "cards spin in and stack") AND a transition ("the top card expands into the next shot"). These describe actions, not seconds. Timing belongs to the animatic, not these notes.

Promise only buildable frames. Read scene-engine pages react-scenes/checklist and gsap page revline; for 3D read three-scenes/three-craft. GSAP layers, SVG stroke drawing, paper texture and hand-drawn plates can build a hand-drawn FINAL film too; sketch style is not an engine limitation. Follow motion-design page image-plates for the asset decision order. Never generate reproductions of a reference video's frames.

Inspect each candidate using image-direction's self-check. Regenerate a failed frame once with a sharper brief; call presentStoryboard with the accepted assetIds and reviewNote only after looking. The in-app grid above EditComposer shows images and shot numbers only; keep shot notes in saved metadata. Over MCP show the accepted returned images in the client's chat. Apart from the one-line Look and the approval question, let the images carry the presentation. Wait for OK/edits; then saveStoryboard stage: "rough" with frameAssetIds in shot order.

## 4. Style frames: lock the final look
Render only 2–3 key moments in the FINAL look, using image-direction. Use purpose: "storyboard", phase: "style", the same name and the represented shotIndex. Low or medium Flare quality keeps exploration cheap. The first style frame anchors the rest via referenceAssetIds; use the relevant rough frame too when helpful. Lock palette, type hierarchy and texture; keep in-image lettering approximate and final text editable. A hand-drawn finish is valid: refine the ink, paper and line rhythm, not into a glossy render.

Self-check, presentStoryboard, show the images and wait for the user's approval of the look. SaveStoryboard stage: "style" with the rough frameAssetIds and 2–3 styleAssetIds, first style anchor first. An image model's attractive effect is not evidence the engine supports it.

## 5. Animatic: watch the pace before code
After style approval, createTimeline for a dedicated animatic. Pass its timelineId explicitly to addMedia: place the approved ROUGH frames in shot order, with real durations matching the intended pace. Add the agreed voiceover or temporary music if there is any, using the music-and-sound skill. A silent brief needs no invented soundtrack. This is the one planning use that deliberately places board images on a timeline; generated candidates otherwise stay reference media. Do not write scene code yet.

Let the user watch in Revline and request timing changes. No export is needed for this review. SaveStoryboard stage: "animatic" with animaticTimelineId and the accepted rough/style IDs only AFTER the user approves pacing. Preserve motion notes, transitions and assetsNeeded in the structured plan. readBrief, getProject and inspectTimeline expose it to later sessions.

## 6. Build and compare
On approved animatic, hand off to motion-design. Replace the animatic with the real editable film (follow its one-film/one-scene guidance); retain the planning timeline and reference media for later sessions. Build from the saved ideas, text, motion, transitions and asset needs. Check rendered beats against the STYLE frames with compareReference and readFrames/getFrames, and check motion with checkPacing. Style frames express intent and hierarchy, not pixels to trace. Keep board images out of the finished film.

## Cheap changes
"Change frame 3" regenerates only frame 3, with its existing phase/name/shotIndex and that stage's first-frame reference. Leave other images intact. If changing the anchor itself, use its previous image as reference unless the user changes the whole look. Self-check, present the revision and reapprove the changed stage; revisit later approvals when the change affects them. Keep costs visible from generateImage's estimatedUsd and usage, not invented prices.
`,
};
