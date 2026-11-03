import type { EditorSkill } from './index';

export const storyboard: EditorSkill = {
  name: 'storyboard',
  description: 'Before a new motion film: brief, message/tension/3–5 angles, conversational concepts, complete timed walkthrough, black-ink board, style frames and animatic. User approval gates every build stage.',
  body: `# Storyboard

## 1. Brief
1. Run this flow before a new film. Skip it for a small existing edit or "just build it". Call readBrief and inspectTimeline first; resume the saved stage instead of repeating an approved stage.
2. Read the user's message, uploaded media and matching getBrandKit result. Read a supplied site with createBrandKit { url }. Ask at most 2–3 missing questions in ONE message, with defaults for audience, product, platform/aspect ratio, length, audio and CTA. For a launch with no requested length, use 30–40 seconds; an explicit 12-second request wins. Example brief "A 35-second launch for editors, with sound, ending on the confirmed product line."
3. Ask for a real logo/app screenshot in that same message when needed. Check getBrandKit screens or supplied project images before drawing product UI. Use zero invented controls when a real screen is available. For "no logo", draw no logo. Save only the user's actual lasting direction with updateBrief; wait for their brief reply.

## 2. Ideation — agree on the message
4. Before writing concepts, propose MESSAGE in one plain sentence: what the viewer should believe after watching. Bad "Make the video you imagined without juggling tools." Good "Editing software hasn't changed in 7 years. Revline is the first thing that feels different." The latter is the user's proposed message, not a history claim to invent for another product; check product claims/numbers against readBrief or ask once.
5. State TENSION in one sentence describing an audience problem they already recognise. Example "For 7 years every editor has been the same timeline." Ask about that feeling when it is missing; do not replace it with a list of three features.
6. Offer 3–5 ANGLES, each one sentence someone can picture plus "Hooks because …" in plain words. Include at least one angle of your own and say why you like it. Example angles for the message above:
- Seven desks replay the same trim; one desk stops repeating. Hooks because editors recognise the repetition before seeing the product.
- A factory stamps seven identical timelines; the eighth breaks the mould. Hooks because the broken pattern makes the change visible.
- One manual cut stays fixed while the rest of an edit changes. Hooks because it answers the fear of losing work to automation.
Example opinion "I'd lead with the factory: its repeated stamp makes the break obvious."
7. Talk through the message with the user before concepts: answer their questions, revise the message/angles and ask one question that resolves the next uncertainty. Example "Is sameness the thing you want to attack, or losing your edits?" After their agreement, store the agreed message/tension with updateBrief and their actual words. Make zero saveStoryboard calls and generate zero images during this discussion.

## Conversation mode — answer the current turn
8. If the user asks a question or adds an idea, answer it directly in the first 1–2 sentences, then add your own take. Example user "What u have in mind?" → "Seven identical editing desks, then one breaks the loop. I'd hold that repetition long enough for editors to recognise it." Continue into the walkthrough below; do not re-post the same A/B choices.
9. Build on the meaning under a metaphor. User "Throw it in the trash." Bad: bin → compactor → rocket bin. Good: "Does trash mean the old tools, or doing the same edit again? If it's sameness, I'd show seven years of identical timelines, then break that pattern." If the meaning is already clear in their words, state that reading and develop it instead of asking again.
10. End with one question that moves this conversation forward, not a fixed A/B sentence. Examples: "Is that the frustration you want to open on?", "Which proof would make you stop scrolling?", "Should I draw the factory opening?" Ask for a choice only when the user actually has a new choice to make.

## 3. Concepts — only after the message is agreed
11. Offer two concepts only after the message is agreed AND two new on-screen approaches need a choice. Each concept is a name plus 2–3 sentences, with at most 50 words in its body and at most 12 words per sentence (quoted on-screen copy can contain punctuation). Add ONE separate "Hooks because …" line of at most 15 words. Save only the body in concepts[].text; put the hook reasoning and agreed message in saveStoryboard context after the user's choice.
12. Use visible objects/actions and exact on-screen words; omit Look, Motion, Why-it-works and How-it-was-made fields. Delete these words from concept bodies: "living", "shape/shaping", "control", "journey", "clarity", "noise", "space", "seamless", "elevate", "story", "sense of". Bad "A single instruction becomes a living timeline that the creator can keep shaping." Good "Seven identical timelines stamp onto a conveyor; the eighth refuses the stamp."
13. Choose ONE undeniable product proof, not a feature tour. Compare at least two candidates against the audience's stated frustration and say which is more surprising. Bad default "Type a prompt; a podcast becomes Shorts; then show motion design." Better example "An existing multi-layer edit changes around one untouched manual cut." Verify that exact operation with the real product/screens/tools before promising it; pick another verified proof if it cannot be demonstrated.

**A — The eighth timeline**
Seven identical timelines roll off a factory press. The eighth changes around one cut that stays fixed. Ends on "Editing, finally different."
Hooks because editors recognise the routine before the pattern breaks.

**B — Keep this cut**
Seven copies of an edit repeat the same trim. One manual cut stays while everything around it changes. Ends on "Your edit stays yours."
Hooks because it shows automation without taking away the editor's decisions.

Which proof feels closer to the frustration you want to show?

14. After an actual user choice, saveStoryboard stage: "concept" with concepts: [{ name, text }, { name, text }], chosenConcept: 1 or 2 and their quoted words in approvalNote. Never infer approval from a request to run a proof. If the message or direction changes, discuss that change instead of repeating the previous concepts.

## Show the whole picture when asked
15. "Sketch it", "show me" and "what do you have in mind" request the whole proposed film: give a beat-by-beat walkthrough with time ranges, exact on-screen text, sound and the world/look. The 50-word concept-body limit does not apply to this walkthrough. Before a sketch selection, ask which concept to draw (or offer rough sketches of both); do not answer with pasted A/B prose or manufacture an approval to unlock generateImage. Keep the existing concept gate for image generation.
16. GOOD — 35-second worked walkthrough for the example message above. This develops one proof, not all three Revline features. World/look: seven graphite editing desks in one long workroom, paper labels and flat overhead light; the final look adds one accent after the repeated pattern breaks. Rough-board images remain black ink on white. Sound: repeated mouse/keyboard clicks, a held silence at the break, then the real edit's playback and one closing hit.

| Time | What the viewer sees and reads | Sound |
| --- | --- | --- |
| 0–5 s | Track past seven identical desks replaying the same trim. "Seven years. Same timeline." | The same click and short playback fragment repeat at each desk. |
| 5–10 s | The camera reaches an eighth desk. Its repeated trim stops; the other desks keep looping. | One expected click is missing; hold the silence. |
| 10–16 s | Move into one real existing multi-layer edit. A hand makes one visible manual trim. "This cut stays." | Mouse release and a short playback pause. |
| 16–23 s | The verified product action reorganises the surrounding edit while that cut remains untouched. Show the actual timeline changing, not just someone typing. | Clips land against the edit's own audio rhythm. |
| 23–30 s | Play the changed sequence full-frame, then reveal the preserved cut on the real timeline. Let viewers see the result hold. | Real playback continues; stop the repeating workroom clicks. |
| 30–35 s | Pull back to the eighth desk playing the new edit. "Editing, finally different." Add the confirmed wordmark, or omit it for "no logo". | One closing hit with a short tail; leave the line readable. |

17. After the walkthrough, ask one specific question, for example "Does keeping that manual cut prove the difference you mean?" If the user answers with an idea, develop it. A walkthrough is not approval of the concept, rough board, style or animatic.

## 4. Black-ink board
18. Read image-direction before generateImage. Honor a supplied style/brand/reference; otherwise choose one look and state it once with the sketches. Example "Look: black ink and cross-hatching; colour comes in the style frames." Do not ask for a separate style pick.
19. Generate 3–6 frames, one complete drawing per shot, in the film's aspect ratio. Use purpose: "storyboard", phase: "rough", quality: "low", count: 1 and one shared name. Draw first and last before the middle. Pass frame 1's assetId as a reference for all later rough frames.
20. Draw the ACTUAL final shot: recognisable objects, their exact count, composition, camera angle and exact on-screen text. Use clean black-ink contours and cross-hatching on white paper, with a few light diagonal pencil strokes in the background. Use zero colour, accent colour, blank boxes, placeholder lines, borders, arrows, shot numbers or production notes. Example a fully drawn CRT and keyboard lettered "GENERATING YOUR IMAGE 52%"; never a box labelled "A BIG HEADLINE". See image-direction's bad/good Shot 1 table.
21. Store shotIndex, duration, idea, visual, onScreenText, motion, transition and assetsNeeded in metadata. Use plain actions for motion/transition: "headline fades up", "cards spin in and stack", "the top card expands into the next shot". Draw the onScreenText exactly in the image; rebuild it as editable type later. Shot numbers/timing appear only in metadata and the caption.
22. Check buildability with scene-engine react-scenes/checklist and gsap revline; for 3D check three-scenes/three-craft. Hand-drawn final shots can use stroke-draw SVG, one paper texture and separately animated hand-drawn plates, as in study DfMzGyNBdUH. Use motion-design image-plates for asset selection. Generate zero copies of reference-video frames.
23. Inspect each preview at full size. Ask "Could the final frame be built by colouring this sketch? If not, regenerate." Match every object and lettered line to the planned shot. Regenerate only a failed frame, once, with the exact correction; stop for the user if the second attempt fails. Then call presentStoryboard with the inspected assetIds. This is review, not approval.
24. In-app, use the existing numbered image grid above EditComposer. Over MCP, put each accepted frame in your reply as ![Shot N](url), one per line, with a caption under each of 12 words or fewer. Use the returned presentStoryboard frames[].url or generateImage assets[].url. Never send the user to the editor to see them. Include shot number/timing in the caption when needed, for example "Shot 2, four seconds — scissors cut three Shorts."
25. END THE TURN after presenting. Wait for the user's actual OK/edits. SaveStoryboard stage: "rough" with frameAssetIds in shot order only after their approval; quote it in approvalNote. An inspected preview, tool success or silence produces zero approval writes.

## 5. Style frames
26. After rough-board approval, generate only 2–3 key moments in the final look, phase: "style", low/medium quality. Reference the first style frame in the others. Keep the approved objects, framing and words; add the chosen palette, type and texture. A hand-drawn finish can retain ink and paper. Inspect, present, END THE TURN, then save stage: "style" only after the user's look approval.

## 6. Animatic
27. After style approval, createTimeline for a dedicated animatic. Add the approved rough images in shot order with addMedia, explicit timelineId, start and duration; add agreed voiceover/temp music only if the brief includes it. Write zero scene code at this stage. Let the user watch in Revline; no export is needed. After their pacing approval, save stage: "animatic" with animaticTimelineId and the rough/style asset IDs.

## 7. Build and edits
28. After animatic approval, use motion-design to build the editable film on a new createTimeline tab; retain the animatic. A launch uses the audience's tension as its hook, ONE verified proof in the middle, then a payoff line. Use 30–40 seconds by default: 0–5 seconds for the hook, the last 4–6 seconds for payoff/wordmark; explicit user length and "no logo" win. Replace each planned shot with the real scene inside its one-film/one-scene structure. Compare built frames with STYLE frames using compareReference/readFrames/getFrames and check motion with checkPacing. Treat the board as the objects/composition target; keep its images off the finished film.
29. "Change frame 3" regenerates only frame 3 with its phase/name/shotIndex and frame 1 reference. Self-check, present it and wait again. Changing an approved anchor or shot requires renewed user approval for the changed stage; never manufacture that approval to unlock a tool. Read estimatedUsd/usage from each generation; null is unknown, not zero.
`,
};
