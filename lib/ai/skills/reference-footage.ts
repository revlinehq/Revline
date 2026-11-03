import type { EditorSkill, EditorSkillPage } from './index';

const recreation: EditorSkillPage = {
  name: 'recreation',
  description: 'The full recreation workflow: section inventories, exact content, layered camera behavior, rendered transition comparisons and close-out. Existing edits start with scene-engine page edit-lanes.',
  body: `# Recreating a motion film

For edits to an existing recreation, start with scene-engine page \`edit-lanes\`. The inventory, dense reads, comparisons and close-out below apply only in Precise. A new recreation always runs Precise; Fast changes to an existing recreation use local frame checks instead.

The supplied video is the brief. Read motion-design and scene-engine for implementation. This page owns the recreation workflow. Take the words, UI, brand, timing and motion from the reference; ask only for something the video cannot answer, such as a different format or length. Keep the reference video itself off the timeline.

## 1. Map the film, then inventory one section
Read the whole reference with readFrames count 16 for its moments and holds. Shots alone miss motion inside a shot. Group related moments into named sections, including their incoming and outgoing transitions.

Before building a section, read every change from a little before its onset through its settle with readFrames at 10 to 15 fps. Each sheet holds at most 30 frames: continue from its last returned time until the entire section is read. Open full-size frames or crops for details. Write a numbered effect inventory in your reply, with one item per visible change, including simultaneous changes on different layers:
- Time window and what it is, including its first visible frame, end and settle.
- Layer: background, foreground, cursor or UI; name the object within that layer.
- Type: cut, continuous zoom, spring, stagger, morph, mask, blur, dither, click, hover, scatter or the specific behavior seen.
- Count: every container, piece, click and staggered entry, including their order and spacing.
- Color and thickness: measured colors, strokes and pixel/block sizes.
- Exact content: every word, logo, icon, face and shape, plus its source crop.

Build only from this inventory. A three-container menu needs three staggered containers. Record scattered cubes, clicks and text hovers during scrolling even when the moments detector does not name them. Crop and read every logo, icon, face and text before implementing it. Use findIcon for an identified icon, traceShape for its actual outline, matchFont for type and measureFrame for colors and edges. Never substitute a guessed logo or symbol for a face or unread detail. Re-read anything uncertain.

## 2. Read camera behavior per layer
Run motionMap on each section and trackReference separately on the background and foreground objects that move differently. Record what stays fixed. Distinguish following the cursor from waiting for the scroll and then springing. Measure start, path, acceleration, overshoot and settle for each layer. A background can spring zoom out while a terminal stays put. A continuous push into an object must stay continuous across the section boundary. Keep a cut instantaneous. Measured behavior wins over motion-design defaults, including holds and linear motion.

## 3. Build and verify this section before the next
Use addFilm for one continuous film with section markers. Build the first section, leaving insertion markers for later sections. Set builtThrough to that section's film-second end so addFilm checks reads for the implemented part while keeping the full clip duration. Extend it with patchScene. For corrections, inspectClip with section (marker label or id) or lines {start,end} returns short exact blocks with absolute line numbers. Use patchScene with that section and small find/replace edits, or edits [{lines:{start,end},replace}] without quoting old code; pass expectedRevision from the read. Line edits share one inspected snapshot, must not overlap, and need a new read after saving. A failed find returns nearby numbered lines to copy. Without markers, use whole-scene line ranges. A transition spanning sections belongs on their shared timeline; heed shared-code warnings, include affected sections in scope, and verify both sides of the boundary.

Match the big moves first: every inventory transition, layer, count, order, onset, duration and camera behavior must match before polishing colors or offsets. Do not close a button on the scene-change frame unless the reference does. Keep connected motion continuous through boundaries.

Verify rendered pixels, never code, tween parameters or cue times. An effect scheduled at the right time may remain invisible behind a threshold or mask. Find its first visible rendered frame and compare it with the reference, then its pace, peak and disappearance.

Run compareReference with start, end and fps 15 across EVERY transition window, including padding before onset and after settle. Split long windows into adjoining calls and inspect every returned pair. Sparse times are only for steady stretches. Crop a small effect or detail and score that region on its own; a quiet background can hide a missing click or wrong pixel thickness in a whole-frame score. Scores rank differences, they do not certify a match, even at a low percentage.

Run compareMotion for this section against the reference: check camera path, layer movement, timing, easing, overshoot, settle and cuts. Fix residual differences with patchScene and repeat both checks on the new rendered revision. A motion residual needs a correction; reporting it is not verification. Inspect uncertain layer behavior with trackReference and cropped frame comparisons. Finish and verify the section, including its boundary with the preceding section, before building the next.

Find code with inspectClip search: {query: "text"} (regex: true for a per-line pattern), then read its numbered lines before patching with expectedRevision. Use diffScene with fromRevision and toRevision from listRevisions to review saved code changes. After checking the rendered saved revision, attach what changed and the actual verification evidence with recordFix (clipId, revision, summary, verification); later turns read it in listRevisions.

## 4. Close out against the inventory
Mark EVERY numbered item as matched by rendered evidence, or explicitly off with its remaining discrepancy and time. Recheck all section boundaries after the final edits. Fix residual compareMotion differences before claiming a match; if a tool limit prevents a fix, list it as off. Never call a recreation matched because a score falls below a threshold or a fixed number of passes has elapsed. Run the scene-engine checklist; the inventory remains the acceptance list.

Match music with matchMusic using the reference's tempo and main inventory moments. Regenerate its effects with generateSound, place them at the matching visible hits and verify with checkSound. End music and effects with the film. Never copy the reference audio. Confirm any voiceover with a transcript; if it cannot be reproduced, finish the visuals and state the missing recording explicitly.
`,
};

const socialEdit: EditorSkillPage = {
  name: 'social-edit',
  description: 'Remaking an edit of footage cut to music (Instagram and TikTok edits, fan edits, velocity edits, sports and car edits).',
  body: `# Remake: social edit

The reference is footage cut to a song. What makes it is the rhythm: where cuts fall on the beat, how speed ramps into hits, and which flash, shake or zoom marks each one. Remake the edit, using the user's footage.

## Footage
- The user's footage is the material. Find the moments that do the same job as each reference shot: the reveal, the action, the slow beat before a drop. Use analyzeMedia understand, then inspectVideo with the actual moments you need.
- No footage in the project: list what each shot needs (for example "S1 to S3: a slow establishing shot. S4: fast action on the drop") and ask for it. Never put the reference's own footage on the timeline as the remake.

## Music
- Use the user's track and measure it (markMusicBeats or analyzeMedia beats). The reference's audio stays off the timeline unless the user asks for it.
- Map the reference's rhythm onto the user's beats, not onto seconds: a cut that fell on a downbeat lands on a downbeat; a two-beat shot stays two beats. Use alignCutsToBeat after placing the shots.

## Shot by shot
- Length: the reference shot's length in beats (from rhythm.bpm), not in seconds, unless the reference has no music.
- transitionIn: cut is a hard cut; every other kind maps to an addTransition preset as on page \`borrow\` (Mapping), at the reference's measured length and direction.
- camera speed-ramp becomes setSpeedRamp into the hit. shake on a hit becomes a short shake effect at that beat. push-in becomes configureSmoothZoom or a zoom effect over the shot.
- Titles and captions: rebuild their style (size, weight, case, enter) with the text tools, with the user's words.
- Look: match the grade the reference describes (applyLut, setColorCurves, grain), using the user's footage as the base.
`,
};

const motivation: EditorSkillPage = {
  name: 'motivation',
  description: 'Remaking a motivation or quote video: footage under a voiceover or quote, with bold captions.',
  body: `# Remake: motivation video

The reference is footage under a voice (a speech, a quote, a narrator), with large captions that carry the words. What makes it: caption style, how each line is timed to the voice, and slow, weighty footage that cuts on the sentences.

## Voice and words
- The words come from the user: their own voiceover, a speech they have the rights to, or a script they approve. Never reuse the reference's voiceover or its quote as the remake.
- Transcribe the voice (analyzeMedia transcribe) and key every caption and cut to its words. Speech counts only once the transcript has it: a video description (inspectVideo, understand) can invent a voiceover.

## Captions
- Rebuild the reference's caption style from its titles: size, weight, case, font class, position, and how words appear (word by word, a pop, one key word in a color). Apply it with addSubtitlesFromTranscript and styleCaptions, or with applyCaptionStyle.
- Keep the reference's line length (the number of words on screen at once).

## Footage and pacing
- Cut on sentence ends and strong words, keeping the reference's median shot length. Slow shots stay slow (smoothSlowMotion or setPlaybackRate when the reference ran slowed footage).
- Match the grade and texture (contrast, desaturation, grain, vignette).
- No footage: say which kinds of shots each part needs and ask for them.
`,
};

const borrow: EditorSkillPage = {
  name: 'borrow',
  description: 'Borrowing one part of a reference (a transition, a title style, the pacing, the look) for the current edit, and how each part maps onto controls.',
  body: `# Borrow a style

Change only what the user named. Every other clip, title, timing, color and sound stays exactly as it was.

## Find what they pointed at
The message names shots and parts by id (S4, S4.title, T2) or in words ("the second transition", "the title at 0:07", "that zoom"). Resolve both with inspectReference before building, and say what you understood by id ("S4's whip right, 0.35 s"). When a part is unclear in the breakdown, look at it with readFrames fps 10 on the reference around that shot's time.

## Mapping
- A transition: addTransition with the closest preset and the measured seconds, on the cut the user named, or on every cut if they said so. whip is whip-pan, zoom is zoom-through, dissolve is crossfade, blur is blur-dissolve, spin is spin-zoom, wipe is gradient-wipe (or iris-wipe for a circle), light-leak is film-burn, flash is a short white flash on the cut.
- A title style: text clips get setTextStyle, setTextAnimation or applyTextLook with the measured size, weight, case and enter; captions get styleCaptions. Titles inside scenes change with editScene: only the title's CSS and GSAP, nothing else in the scene.
- A camera move: configureCameraMotion or configureSmoothZoom on footage; the scene's camera timeline inside scenes.
- Pacing: keep the order of the user's shots and move their cuts toward the reference's shot lengths (and onto beats when onBeatRatio is high), with trim and alignCutsToBeat. Say how many cuts moved.
- The look: grade with applyLut, setColorCurves or matchColor; texture with grain or vignette effects.
- A signature (T1, T2): apply its recipe wherever the user asked, with the shots it lists as the model.
`,
};

export const referenceFootage: EditorSkill = {
  name: 'reference-footage',
  description: 'The user shares a video to remake or to take style from (an edit, a motivation video, anything; recreating a launch or motion film is motion-design) and points at parts of it ("this transition, this title, this pacing"). Read before analyzing a reference, before a remake, and before borrowing any part of one.',
  body: `# Reference footage

The user shares a finished video and wants either a **remake** (the same edit made with their own material) or a **style borrow** (one or more parts of it applied to their edit).

For original work inspired by a reference, read motion-design page \`taste\`: extract the reasons behind its choices and find a new expression. The remake and borrow workflows below apply when the user asks to reproduce or apply specific parts.

## 1. Break it down
- Run analyzeMedia with mode reference on the shared video. It measures the cuts and beats, then splits every shot into parts: transition in, camera, look, the screen's parts (background, footage, ui, title, caption, logo, product, person, cursor, shape, emoji, overlay) and title styles. It also writes the five-line style direction and the signatures (the moves that define the style).
- Measure at full resolution. Read positions, sizes and type from full-size frames (readFrames with crop, and measureFrame for exact colors and edges), never from a downscaled contact sheet: a shrunk sheet makes type and objects look about half their real size.
- The reference stays off the timeline. Never place it there unless the user asks for it. A file dropped into an empty project lands on the timeline by itself: before building a remake, delete that reference clip from the timeline (it stays in media).

## 2. Describe it
Reply with the breakdown, short and concrete:
- One line: what it is (genre), its length and shot count, the rhythm (median shot, cuts on the beat, bpm).
- One line per shot (group long runs of similar shots): id, time, transition in, what is on screen by part, title style when there is one. For example: "S4 (6.2 to 8.1 s): whip right in. Phone UI cropped to the composer, small grotesk headline blurs in, slow push in."
- The signatures by id (T1, T2), in a few words each.
The chat shows the breakdown as a card where the user can click shots and parts to add them to the next message. Mention this once.
Then ask, only if the message did not already say: remake it, or borrow which parts?

## 3. Remake or borrow
- **Remake:** load the page for the genre: \`social-edit\` or \`motivation\`; for ad, music-video, vlog or tutorial use the closest one (an ad of footage is social-edit). For a launch or motion film, load this skill's \`recreation\` page and motion-design. For a footage edit, say what comes from the reference and what comes from the user's material. If it needs material the project does not have, list it per shot and ask before building.
- **Borrow:** load \`borrow\`. Change only the named parts.

## Rules
- For a footage edit or style borrow, copy the edit using the user's material. For an explicitly requested motion-film copy, follow page \`recreation\` for exact visible content.
- Measured numbers (shot lengths, cut times, beats, onBeatRatio) are exact. Transition kinds, camera moves and title styles are the model's reading: when one decides the result, check it with readFrames fps 10 on the reference before building.
- After building, go through scene-engine page \`checklist\` for scenes, and look at the result with getFrames at the shots that matter.`,
  pages: [recreation, socialEdit, motivation, borrow],
};
