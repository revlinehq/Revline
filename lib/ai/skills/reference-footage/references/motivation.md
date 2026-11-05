---
name: "motivation"
description: "Remaking a motivation or quote video: footage under a voiceover or quote, with bold captions."
---
# Remake: motivation video

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
