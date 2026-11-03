import type { EditorSkill } from './index';

export const explainer: EditorSkill = {
  name: 'explainer',
  description: 'A narrated explainer film made from scratch: a motion-design film that explains one idea while a generated voice speaks the script. The four steps, each confirmed with the user (script, voice, visual style, then the film), and the craft of timing visuals to spoken words. Read before writing an explainer script or calling generateVoice for one. Explainer visuals over the user\'s own footage use explainer-scenes instead.',
  body: `# Narrated explainer films

Narration carries the explanation; visuals land on its words. Build with addFilm and useTimeline (scene-engine, gsap). Keep this approval workflow separate from launch-film planning: the voice fixes the film’s clock.

## The four steps

Each step ends with the user's yes before the next starts. Ask with askUser and end your turn; never run ahead and build the next step on a guess. When the request already settles a step (the user gave the script word for word, named a voice, or chose a style), say so and skip only that step.

### 1. Script

Show the script with rough beat lengths at 2.5 words/s; use prose or a list that suits it. Example:
\`\`\`
1. (3 s) Every app you use waits on a network.
2. (4 s) Most of that wait is the same request, sent again and again.
\`\`\`
- One claim/picture per beat. Split unrelated claims; a connecting “and” alone is no reason to split.
- Short spoken sentences, 6 to 14 words. Write for the ear: concrete nouns, active verbs, no lists of three adjectives, no jargon the viewer has to stop and decode.
- Open with the problem or the question in the first beat, not with a title or a greeting. Close on the one thing to remember.
- 30 to 60 seconds total unless the user asks for another length: 8 to 16 beats.
- Use the user's facts and words. Never invent numbers, quotes, customers or features; leave a gap and ask instead.
- No em dashes in the script: use periods and commas, which the voice reads as pauses.
Then askUser: "Use this script?" with options such as "Use this script", "Shorter" and "Change the tone". Revise until they approve.

### 2. Voice

Pick 3 or 4 voices from listVoices that fit the script's tone and audience (a calm British storyteller, a bright educator, a warm narrator), varied enough to be a real choice. Call listVoices once with sampleText set to the approved script's first line and those voiceIds. Then askUser "Which voice?" with one option per voice: label the voice's name, description what it sounds like, audio its sample URL exactly as returned. Every option must carry its audio: the card plays each sample with its own play button. Your reply is one short line introducing the choice; never write that samples are "above", list their links or ask whether they play. If a sample failed, call listVoices again for that voice before asking.
After the pick, call generateVoice once with the whole approved script, joined into one text in beat order, at timeline second 0.5 (a short breath before the first word). Speak it as one take so the delivery flows; never one call per line. Keep the returned words list: it is the clock for the whole film. If the user wants a line changed later, regenerate the whole narration and retime.

### 3. Visual style

Build 3 or 4 code previews of the same first beat. First: overall-styling’s isometric diagram (page "example"). Alternatives specify background/text/accent hexes, font/size, layout and timed reveal: paper #F5F1E8/#171717/#B14A32 with serif type; dark #111/#F5F5F5/#76B900 with sans; or a grain gradient with rounded cards. Multicolor faces require an explicit palette and user choice; no bright purple fills. Follow the confirmed brand kit; use askBrandKit when absent. Each preview is about 3 seconds with real motion, placed one after another on the timeline after the narration (for example at 0, 3, 6 and 9 seconds past its end), with addScene or one addFilm whose sections are the looks. Check each with getFrames, then askUser "Which style?" with one option per look: preview.time set to the second where that look's frame is fully built (not its first frame), label naming the look, description one line about it. Every option must carry its preview: the card shows each look as a large picture, so the user judges the real frames, not your words. Never ask about styles in prose or without previews. After the pick, delete the previews before building the film.

### 4. The film

Build the film in the chosen look with addFilm, following motion-design (one clip, one timeline, sections as markers, patchScene for every change) and scene-engine. Place it from timeline 0 so the narration sits under it. Then:
- Sections: one per beat, each starting where its beat's first word starts (from the words list), so the markers line up with the voice.
- Sound: use music-and-sound’s gap-only cue policy; gain 0.3–0.5. No music unless requested.
- Run the scene-engine checklist (readSkill name "scene-engine" page "checklist") and fix what fails. Check key beats with getFrames at the moment each key word is spoken.
- Use addSubtitlesFromTranscript on narration unless the user opts out. Apply overall-styling’s subtitle values; inspect getFrames so text covers no key drawing part.

## Timing to the voice

The words list from generateVoice gives every word's timeline start and end. The film's own clock starts at its clip start, so film second = timeline second minus the film's start (0 when it starts at 0).
- **Land on the word.** The visual for a word arrives as that word is spoken: start = word start minus reveal duration. A 0.8 s draw landing at 2.0 s starts at 1.2 s. A number counts up to finish on the number; a highlight sweeps on the key noun; a diagram arrow draws during the verb that names the move.
- **One idea on screen.** When a beat ends, its picture leaves or transforms into the next one; never pile beats up. Carry an element across beats when the idea continues (the same card moves, a dot becomes a chart) instead of cutting.
- **Draw distinguishing parts.** List 2–3 before drawing: server rack → rails, stacked units, drive bays; database → cylinder; piston → cylinder, rod, crankshaft. Inspect a full-size crop for each feature.
- **Motion serves the beat.** Use checkPacing and intermediate poses to inspect draws, turns, packets, counters or camera moves. Preserve reading holds; unequal frames alone do not prove useful motion.
- **Pace to the voice.** Pauses in the narration (gaps between words over about 0.4 s) are where big changes happen: a scene change, a camera move, a reveal. Inside a sentence, keep motion small and supportive. Hold the last frame about a second after the last word.
- **Words on screen are the key words, not the script.** Show the 1 to 4 words that carry the beat (a number, a name, a term), not the sentence the voice is already saying.
- Write the beat times into the film code as named constants taken from the words list, so a retime is a patchScene to those numbers.

## Checking

Check getFrames on key-word starts: intended visual visible, distinguishing object parts present, previous beat gone, final hold ≥1 s after narration. Apply scene-engine’s text checks. Report the film, voice and style; describe any remaining defect.`,
};
