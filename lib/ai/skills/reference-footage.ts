import type { EditorSkill, EditorSkillPage } from './index';

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
- transitionIn: cut is a hard cut. whip becomes addTransition whip-pan (0.3 to 0.5 s) with its direction. zoom becomes zoom-through. dissolve or blur becomes crossfade or blur-dissolve. flash becomes a short white flash on the cut. spin becomes spin-zoom. light-leak becomes film-burn.
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

const launchFilm: EditorSkillPage = {
  name: 'launch-film',
  description: 'Remaking a product, brand or feature launch made with motion design: rebuilt as scenes for the user\'s product.',
  body: `# Remake: launch film

The reference is a motion-design launch. Remake it with the motion-design skill (read it), for the user's brand and product. Never the reference's product, UI, logo or copy.

- The reference's direction (look, type, productUi, motion, pacing) replaces the example direction in motion-design step 5. Brand-kit fonts and colors still win over the reference palette.
- Each reference shot becomes one beat in the beat sheet, with the same length, transition and camera move. Shots that share a UI build share one scene with internal beats.
- Parts map to scene code: ui becomes the user's product UI, rebuilt from their brand-kit blueprint. title keeps the measured size, enter, ease and hold, with copy written for the user's product. background follows the look line in the brand's colors. cursor stays only if the reference shows one.
- Titles stay small and calm unless the reference's own titles are large; then match them.
- After building, render each beat with getFrames and compare it with the reference shot's keyframe (inspectFrames on the reference at that time).
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
- A transition: addTransition with the closest preset and the measured seconds, on the cut the user named, or on every cut if they said so. whip is whip-pan, zoom is zoom-through, dissolve is crossfade, blur is blur-dissolve, spin is spin-zoom, wipe is gradient-wipe (or iris-wipe for a circle), light-leak is film-burn.
- A title style: text clips get setTextStyle, setTextAnimation or applyTextLook with the measured size, weight, case and enter; captions get styleCaptions. Titles inside scenes change with editScene: only the title's CSS and GSAP, nothing else in the scene.
- A camera move: configureCameraMotion or configureSmoothZoom on footage; the scene's camera timeline inside scenes.
- Pacing: keep the order of the user's shots and move their cuts toward the reference's shot lengths (and onto beats when onBeatRatio is high), with trim and alignCutsToBeat. Say how many cuts moved.
- The look: grade with applyLut, setColorCurves or matchColor; texture with grain or vignette effects.
- A signature (T1, T2): apply its recipe wherever the user asked, with the shots it lists as the model.
`,
};

export const referenceFootage: EditorSkill = {
  name: 'reference-footage',
  description: 'The user shares a video to remake or to take style from (an edit, a motivation video, someone\'s launch film, anything) and points at parts of it ("this transition, this title, this pacing"). Read before analyzing a reference, before a remake, and before borrowing any part of one.',
  body: `# Reference footage

The user shares a finished video and wants either a **remake** (the same edit made with their own material) or a **style borrow** (one or more parts of it applied to their edit).

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
- **Remake:** load the page for the genre: \`social-edit\`, \`motivation\` or \`launch-film\`. For ad, music-video, vlog or tutorial use the closest one (an ad of footage is social-edit; an ad made with motion design is launch-film). Say what will come from the reference (structure, timing, transitions, type behaviour) and what will be the user's (footage, music, words, brand). If the remake needs material the project does not have, list it per shot and ask before building.
- **Borrow:** load \`borrow\`. Change only the named parts.

## Rules
- Copy the edit, never the content: no reference copy, logo, product, people, voiceover or song lifted into the user's video unless the user owns it and asks for it. Title text in the breakdown is there only to recognise the shot.
- Measured numbers (shot lengths, cut times, beats, onBeatRatio) are exact. Transition kinds, camera moves and title styles are the model's reading: when one decides the result, check it with readFrames fps 10 on the reference before building.
- After building, go through scene-engine page \`checklist\` for scenes, and look at the result with getFrames at the shots that matter.`,
  pages: [socialEdit, motivation, launchFilm, borrow],
};
