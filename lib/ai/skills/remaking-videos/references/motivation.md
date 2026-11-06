---
name: "motivation"
description: "Remakes a motivation or quote video: footage under a voiceover or quote, with bold captions."
---
# Remake: motivation video

The reference is footage under a voice (a speech, a quote, a narrator), with large captions that carry the words. A good remake gets three things right: the caption style, how each line is timed to the voice, and slow, weighty footage that cuts on the sentences.

## Workflow
1. Get the words from the user: their own voiceover, a speech they have the rights to, or a script they approve.
2. Transcribe the voice (analyzeMedia transcribe) and key every caption and cut to its words.
3. Rebuild the reference's caption style from its titles: size, weight, case, font class, position, and how words appear (word by word, a pop, one key word in a color). Apply it with addSubtitlesFromTranscript and styleCaptions, or with applyCaptionStyle.
4. Cut the footage on sentence ends and strong words, keeping the reference's median shot length.
5. Match the grade and texture (contrast, desaturation, grain, vignette).

## Rules
- Never reuse the reference's voiceover or its quote as the remake.
- Speech counts only once the transcript has it: a video description (inspectVideo, understand) can invent a voiceover.
- Keep the reference's line length (the number of words on screen at once).
- Slow shots stay slow: use smoothSlowMotion or setPlaybackRate when the reference ran slowed footage.
