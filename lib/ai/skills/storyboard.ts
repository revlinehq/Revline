import type { EditorSkill } from './index';

export const storyboard: EditorSkill = {
  name: 'storyboard',
  description: 'Before motion design from scratch: brief, two short text concepts, fully drawn black-ink shots, style frames and animatic. Stop at each user approval; previews never approve stages.',
  body: `# Storyboard

## 1. Brief
1. Run this flow before a new film. Skip it for a small existing edit or "just build it". Call readBrief and inspectTimeline first; resume the saved stage instead of repeating an approved stage.
2. Read the user's message, uploaded media and matching getBrandKit result. Read a supplied site with createBrandKit { url }. Ask at most 2–3 missing questions in ONE message, with defaults for audience, product, platform/aspect ratio, length, audio and CTA. End with one sentence stating what the film will show. Example "Show a composer turning a stream into three Shorts."
3. Ask for a real logo/app screenshot in that same message when needed. Check getBrandKit screens or supplied project images before drawing product UI. Use zero invented controls when a real screen is available. For "no logo", draw no logo. Save only the user's actual lasting direction with updateBrief; wait for their brief reply.

## 2. Two text concepts before images
4. Write exactly TWO concepts, A and B. Each is a name plus 2–3 sentences, at most 50 words total. Each sentence has at most 12 words, excluding punctuation inside quoted on-screen copy. Use visible objects, actions and the exact words the viewer will read. Example "Scissors cut a streamer’s filmstrip into three phone-sized clips."
5. Use zero labels/colons and zero Look, Motion, Why-it-works or How-it-was-made fields in the concept message. State the look once at sketching time instead. A and B must show different objects/actions: typing clips into a timeline versus cutting a streamer’s filmstrip into Shorts.
6. Delete these words from concept prose: living, shape, shaping, control, journey, clarity, noise, space, seamless, elevate, story, sense of. Replace the sentence with visible nouns/actions. Bad "A single instruction becomes a living timeline that the creator can keep shaping". The user's good wording example is:

> **A — Type it, watch it build**
> You type one sentence. Loose clips fly in and snap into a timeline. You nudge one clip yourself. Ends on "revline. Make it yours."

7. For a 2–3 sentence reply, combine adjacent actions from that wording. Example message:

**A — Type it, watch it build**
You type one sentence; clips snap into a timeline. You nudge one clip yourself. Ends on "revline. Make it yours."

**B — Cut the stream**
Scissors cut a streamer’s filmstrip into three phone-sized clips. A typed prompt turns those clips into moving titles. Ends on "revline. Make it yours."

A or B? Or tell me what to change.

8. End the concept stage with exactly "A or B? Or tell me what to change." Revise the text first when the user changes A or B. Generate zero images and make zero saveStoryboard calls until the user chooses. A request to run a proof is not approval; post the two concepts and END THE TURN.
9. After an actual user choice, saveStoryboard stage: "concept" with concepts: [{ name, text }, { name, text }], chosenConcept: 1 or 2 and their quoted words in approvalNote. Never select/approve on the user's behalf.

## 3. Black-ink board
10. Read image-direction before generateImage. Honor a supplied style/brand/reference; otherwise choose one look and state it once with the sketches. Example "Look: black ink and cross-hatching; colour comes in the style frames." Do not ask for a separate style pick.
11. Generate 3–6 frames, one complete drawing per shot, in the film's aspect ratio. Use purpose: "storyboard", phase: "rough", quality: "low", count: 1 and one shared name. Draw first and last before the middle. Pass frame 1's assetId as a reference for all later rough frames.
12. Draw the ACTUAL final shot: recognisable objects, their exact count, composition, camera angle and exact on-screen text. Use clean black-ink contours and cross-hatching on white paper, with a few light diagonal pencil strokes in the background. Use zero colour, accent colour, blank boxes, placeholder lines, borders, arrows, shot numbers or production notes. Example a fully drawn CRT and keyboard lettered "GENERATING YOUR IMAGE 52%"; never a box labelled "A BIG HEADLINE". See image-direction's bad/good Shot 1 table.
13. Store shotIndex, duration, idea, visual, onScreenText, motion, transition and assetsNeeded in metadata. Use plain actions for motion/transition: "headline fades up", "cards spin in and stack", "the top card expands into the next shot". Draw the onScreenText exactly in the image; rebuild it as editable type later. Shot numbers/timing appear only in metadata and the caption.
14. Check buildability with scene-engine react-scenes/checklist and gsap revline; for 3D check three-scenes/three-craft. Hand-drawn final shots can use stroke-draw SVG, one paper texture and separately animated hand-drawn plates, as in study DfMzGyNBdUH. Use motion-design image-plates for asset selection. Generate zero copies of reference-video frames.
15. Inspect each preview at full size. Ask "Could the final frame be built by colouring this sketch? If not, regenerate." Match every object and lettered line to the planned shot. Regenerate only a failed frame, once, with the exact correction; stop for the user if the second attempt fails. Then call presentStoryboard with the inspected assetIds. This is review, not approval.
16. In-app, use the existing numbered image grid above EditComposer. Over MCP, put each accepted frame in your reply as ![Shot N](url), one per line, with a caption under each of 12 words or fewer. Use the returned presentStoryboard frames[].url or generateImage assets[].url. Never send the user to the editor to see them. Include shot number/timing in the caption when needed, for example "Shot 2, four seconds — scissors cut three Shorts."
17. END THE TURN after presenting. Wait for the user's actual OK/edits. SaveStoryboard stage: "rough" with frameAssetIds in shot order only after their approval; quote it in approvalNote. An inspected preview, tool success or silence produces zero approval writes.

## 4. Style frames
18. After rough-board approval, generate only 2–3 key moments in the final look, phase: "style", low/medium quality. Reference the first style frame in the others. Keep the approved objects, framing and words; add the chosen palette, type and texture. A hand-drawn finish can retain ink and paper. Inspect, present, END THE TURN, then save stage: "style" only after the user's look approval.

## 5. Animatic
19. After style approval, createTimeline for a dedicated animatic. Add the approved rough images in shot order with addMedia, explicit timelineId, start and duration; add agreed voiceover/temp music only if the brief includes it. Write zero scene code at this stage. Let the user watch in Revline; no export is needed. After their pacing approval, save stage: "animatic" with animaticTimelineId and the rough/style asset IDs.

## 6. Build and edits
20. After animatic approval, use motion-design to build the editable film on a new createTimeline tab; retain the animatic. For a product launch build, arrange the approved shots as one promise, one problem, one reveal, three proof moments and a CTA thumbnail. Replace each planned shot with the real scene inside its one-film/one-scene structure. Compare built frames with STYLE frames using compareReference/readFrames/getFrames and check motion with checkPacing. Treat the board as the objects/composition target; keep its images off the finished film.
21. "Change frame 3" regenerates only frame 3 with its phase/name/shotIndex and frame 1 reference. Self-check, present it and wait again. Changing an approved anchor or shot requires renewed user approval for the changed stage; never manufacture that approval to unlock a tool. Read estimatedUsd/usage from each generation; null is unknown, not zero.
`,
};
