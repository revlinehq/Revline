import type { EditorSkill } from './index';

export const explainer: EditorSkill = {
  name: 'explainer',
  description: 'A narrated explainer film made from scratch: a motion-design film that explains one idea while a generated voice speaks the script. The four steps, each confirmed with the user (script, voice, visual style, then the film), and the craft of timing visuals to spoken words. Read before writing an explainer script or calling generateVoice for one. Explainer visuals over the user\'s own footage use explainer-scenes instead.',
  body: `# Narrated explainer films

An explainer is a motion-design film that explains one idea, spoken by a narrator. The voice carries the story; the picture shows exactly what the voice is saying, as it says it. It is built like any film (readSkill name "motion-design", "scene-engine" and "gsap" for the build itself); this skill adds the script, the voice, the style choice and the timing to words.

## The four steps

Each step ends with the user's yes before the next starts. Ask with askUser and end your turn; never run ahead and build the next step on a guess. When the request already settles a step (the user gave the script word for word, named a voice, or chose a style), say so and skip only that step.

### 1. Script

Write a timed script and show it in your reply as a numbered list, one line per beat, each with its rough length (about 2.5 words per second of speech):
\`\`\`
1. (3 s) Every app you use waits on a network.
2. (4 s) Most of that wait is the same request, sent again and again.
\`\`\`
- One idea per beat: one claim, one picture. A beat that needs "and" is two beats.
- Short spoken sentences, 6 to 14 words. Write for the ear: concrete nouns, active verbs, no lists of three adjectives, no jargon the viewer has to stop and decode.
- Open with the problem or the question in the first beat, not with a title or a greeting. Close on the one thing to remember.
- 30 to 60 seconds total unless the user asks for another length: 8 to 16 beats.
- Use the user's facts and words. Never invent numbers, quotes, customers or features; leave a gap and ask instead.
- No em dashes in the script: use periods and commas, which the voice reads as pauses.
Then askUser: "Use this script?" with options such as "Use this script", "Shorter" and "Change the tone". Revise until they approve.

### 2. Voice

Pick 3 or 4 voices from listVoices that fit the script's tone and audience (a calm British storyteller, a bright educator, a warm narrator), varied enough to be a real choice. Call listVoices once with sampleText set to the approved script's first line and those voiceIds. Then askUser "Which voice?" with one option per voice: label the voice's name, description what it sounds like, audio its sample URL exactly as returned.
After the pick, call generateVoice once with the whole approved script, joined into one text in beat order, at timeline second 0.5 (a short breath before the first word). Speak it as one take so the delivery flows; never one call per line. Keep the returned words list: it is the clock for the whole film. If the user wants a line changed later, regenerate the whole narration and retime.

### 3. Visual style

Build 3 or 4 short style previews in code: the same first beat (its words, its idea) drawn in clearly different looks, for example
- clean editorial: off-white paper, one dark ink, one accent, big serif type;
- bold dark: near-black ground, high-contrast sans, one saturated accent used sparingly;
- soft gradient: a muted grainy gradient field, rounded cards, gentle depth;
- diagram: line drawings and labels building on a grid, like a whiteboard.
Pick looks that suit the subject; follow the user's brand kit when there is one (askBrandKit if unclear). Each preview is about 3 seconds with real motion, placed one after another on the timeline after the narration (for example at 0, 3, 6 and 9 seconds past its end), with addScene or one addFilm whose sections are the looks. Check each with getFrames, then askUser "Which style?" with one option per look: preview.time set to the second where that look's frame is fully built (not its first frame), label naming the look, description one line about it. After the pick, delete the previews before building the film.

### 4. The film

Build the film in the chosen look with addFilm, following motion-design (one clip, one timeline, sections as markers, patchScene for every change) and scene-engine. Place it from timeline 0 so the narration sits under it. Then:
- Sections: one per beat, each starting where its beat's first word starts (from the words list), so the markers line up with the voice.
- Sound: generateSound effects on the visual hits that need one (a card landing, a line drawing, a reveal), quiet enough not to fight the voice (gain about 0.3 to 0.5), never on top of a word the viewer must hear. No music unless the user asks.
- Run the scene-engine checklist (readSkill name "scene-engine" page "checklist") and fix what fails. Check key beats with getFrames at the moment each key word is spoken.
- Captions only if the user asks: addSubtitlesFromTranscript works on the narration clip, whose words are saved as its transcript.

## Timing to the voice

The words list from generateVoice gives every word's timeline start and end. The film's own clock starts at its clip start, so film second = timeline second minus the film's start (0 when it starts at 0).
- **Land on the word.** The visual for a word arrives as that word is spoken: its motion settles on the word's start, so it begins about 0.1 to 0.25 s before. A number counts up to finish on the number; a highlight sweeps on the key noun; a diagram arrow draws during the verb that names the move.
- **One idea on screen.** When a beat ends, its picture leaves or transforms into the next one; never pile beats up. Carry an element across beats when the idea continues (the same card moves, a dot becomes a chart) instead of cutting.
- **Pace to the voice.** Pauses in the narration (gaps between words over about 0.4 s) are where big changes happen: a scene change, a camera move, a reveal. Inside a sentence, keep motion small and supportive. Hold the last frame about a second after the last word.
- **Words on screen are the key words, not the script.** Show the 1 to 4 words that carry the beat (a number, a name, a term), not the sentence the voice is already saying.
- Write the beat times into the film code as named constants taken from the words list, so a retime is a patchScene to those numbers.

## Checking

Before saying it is done: play through the beats with getFrames at the start of each key word and confirm the visual for that word is on screen and readable, nothing from the previous beat lingers, and the last frame holds after the last word. Report what you built, the voice and the style, and offer the next change.`,
};
