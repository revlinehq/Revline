---
name: "taste"
description: "Read before original motion design or learning from a style reference: composition judgments, user taste, and a short rendered critique. Faithful copies use reference-footage recreation."
---
# Taste: choose before choreographing

For original films and creative restyling, use these judgments before choosing GSAP techniques. They are questions to resolve for this subject, not a shot recipe. Explicit direction and the project brief win. Faithful copies stay with reference-footage page `recreation`; scene-engine owns rendering and verification; page `backgrounds` and "Timing and easing" in SKILL.md own the look and timing.

## Anchor taste in this user
Read the memories returned by getProject. Use recallMemory for a relevant saved style's full recipe before applying it. When feedback reveals a lasting preference, use remember with the user's verdict and its scope (what worked or failed, and why if they said); distinguish their words from your inference. One rejected cursor is not a ban on all cursors. Project-only direction belongs in updateBrief. Latest explicit feedback wins over older memory.

Observed Revline feedback, evidence to learn from rather than a universal style for every user:
- Liked: the Isometric line diagram, thin white isometric outlines on near-black, hatching on one face, one thin green accent edge, dimension ticks and small sans labels. It makes structure legible with little ink; use that principle where structure is the subject, rather than putting every title inside a blueprint.
- Liked: Terra's motion study; its attention anchors, semantic actions and holds make its variety coherent. Muted film-grain gradients were liked as image fills, but dark grain gradients as a launch film's whole background were rejected (2026-11-05); film backgrounds follow page `backgrounds` and its rated examples.
- Disliked: cheap-looking cursors, bright brand-purple fills, sparkles / AI-magic icons and generic stock-template looks. Prefer a well-made subject-specific action over a decorative symbol for intelligence. A cursor earns its place by demonstrating an interaction.
Retrieve and learn the current user's preferences; these verdicts do not replace their brief or confirmed brand.

## Judgments, not presets
- **Hierarchy / one idea:** Instead of giving a headline, object and labels equal emphasis, choose the one thing the viewer should understand and subordinate the rest, because attention needs a clear first stop. Describe the shot's idea in one sentence before building it.
- **Restraint / negative space:** Instead of filling a quiet corner with decoration, leave room around the subject and along its travel, because empty space gives the important thing weight. Remove an element and see whether meaning is lost.
- **Scale contrast:** Instead of sizing every object comfortably alike, make the important relationship unmistakable through a deliberate large/small contrast, because relative size tells the eye what matters. Protect the silhouette and type clearance throughout the move.
- **Rhythm / holds:** Instead of adding drift to prove the scene is alive, alternate action, recognition and rest, because stillness lets an idea land. A locked camera and a truly held frame are valid choices. Let natural narration lead visual cues and give its pauses room; avoid forcing speech into a cut grid.
- **Easing as character:** Instead of applying the same bounce to everything, choose acceleration and settle for the subject's weight and attitude, because a precise mechanism, a heavy object and a playful response should feel different. Explain that character before picking the curve; GSAP supplies the mechanics.
- **Colour discipline:** Instead of making every layer colourful, limit the palette and give one accent a job, because colour should direct attention or mark a change. A deliberate palette change can signal a new idea; it need not repeat the source's colours.
- **Type as image:** Instead of adding a default heading above an illustration, use letterform, scale, spacing and placement as part of the composition, because type can carry the idea itself. Animate what the words mean, and keep the decisive word readable after the reveal.
- **Meaningful transitions:** Carry the same frame, shape or clip into its next role when that explains the relationship: a selected clip can expand into the hero view; a frame edge can become the next layout's divider. Preserve its identity, position or direction long enough for the eye to follow, then hand attention to the next subject. Easing polishes that handoff; it cannot repair disconnected scenes. A hard cut can make the strongest point; use continuity only when it serves that point.
- **Hero detail:** Instead of spreading tiny embellishments everywhere, concentrate craft where the viewer pauses or comes close, because detail needs attention to be seen. Refine a contact, edge, texture or typographic relationship in the hero moment; simplify its surroundings. Detail density is local, not a reason to add clutter.

Describe each handoff as source → transition → destination: what carries through, where attention goes, and when it rests.

## Learn the reason from a reference
When the user asks for inspiration or learning, readFrames for the whole arc, then a short window around the choices that matter. Inspect full-resolution frames/crops for details; never infer dimensions from a reduced sheet. For each choice you borrow, write a compact chain: observed choice → why it works → a different expression for this brief. Separate observation from inferred intent.

Terra's study suggests that a rapid field of options followed by one held object makes selection feel decisive. Transfer the contrast of abundance and focus to a new subject and composition, rather than reusing its hands, chess pieces, coordinates or timing. Keep only a few principles that serve the brief. Judge originality by whether the idea survives with new imagery and staging, not by swapping colours on the same layout. For an explicit copy, load reference-footage `recreation` and preserve its measured choices instead.

## Taste check before handback
Reuse the frames required by scene-engine; this is a critique of that evidence, not another full inspection pass. For a new scene, getFrames at the entrance, hero/settle and ending (plus existing correctness checks). For a small edit, critique only its changed frames and neighbours; preserve unrelated approved work.

Ask: what is the one idea? What looks generic or default? Where is the moment of craft? Would a top motion designer keep this frame, and for what concrete reason? Name the weakest frame and one visible correction, fix it first with patchScene, then getFrames only for the affected moments. Prefer subtraction or a clearer relationship to another effect. Stop when that specific weakness is resolved; do not redesign a simple edit. Report a remaining weakness honestly.

Stills do not prove rhythm: original films take their timing from SKILL.md "Timing and easing"; when a reference's movement matters, inspect its window with readFrames and use compareMotion to understand the difference. Similarity scores are evidence about a copy, never a score for taste or originality. No reference is required for original work.