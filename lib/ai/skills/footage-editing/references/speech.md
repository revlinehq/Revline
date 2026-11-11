---
name: "speech"
description: "Speech edits from saved transcript and audio evidence: removing pauses, fillers, false starts and retakes, assembling takes, J/L cuts, and when an edit needs the picture. Read before any speech cut or cleanup."
---
# Speech edits

A good speech edit keeps every retained sentence complete and natural, cuts only between words, and stays in sync with its linked audio and captions. Speech edits are decided from the transcript and audio, not by watching the footage.

## Workflow
1. Read the saved transcript around the affected SOURCE range with inspectAssetAnalysis. Pass every needed sentence window in one call.
2. Choose the edit:
   - A whole clip ("remove the ums", "cut the pauses", "clean up the retakes"): call cleanSpeech once.
   - Chosen takes or several cuts in one clip: collect the clean, complete-sentence SOURCE ranges and call retainSourceRanges once with tightenSilence:true.
   - A quick local edit: isolate the affected speech first, so cleanup leaves unrelated speech unchanged.
3. Join the pieces: closeGaps for footage with no timed overlays; for layered edits, follow footage-editing page `edit-lanes` to keep overlays in sync.

## Rules
- Trimming, cutting, choosing takes and removing repeats, fillers or pauses are transcript-and-audio edits: never call inspectVideo or inspectFrames for them.
- Look at the picture only when the request asks for a visual judgement, such as eyes-to-camera cuts, awkward look-ups or script glances. Then read the visual-inspection skill first.
- A short-form deliverable alone does not justify viewing the footage.
- Keep natural pauses (keepPauses:true) only when the user asks for them; exact user timestamps are cut without tightening.
- Use saved shot boundaries for existing cut points and transcript word timings for speech cuts.
- Request word-timed transcription when the user needs captions or edits at specific spoken words; request beat analysis only when the edit needs measured music timing.
- For a new visual question (a fight, a reaction, an object), call inspectVideo with the user's actual question and an optional source window. A saved overview does not answer it.
- Never invent unseen events or spoken words.
- Listen only to an uncertain short join or an actual audio problem.

## J and L cuts
- One setSplitEdits call, after the speech cut and any edge moves: it sets every cut on the layer (or `cuts` by timeline second), unlinks the affected picture from its sound and keeps both in sync. Never hand-build a split edit with unlink, trim, split or move.
- type auto (default) reads the word timings per cut: J where the next line starts on the cut, L where the outgoing line runs up to it; it skips cuts with silence on both sides or one continuous take. Name J or L only for the user's explicit choice.
- Use it when the user asks (J-cuts, L-cuts, smoother cuts, hide the jump cuts) or where a different shot meets a line: another speaker's clip handing off to the take, b-roll or a reaction under the end of a line. On a same-camera jump cut the picture shows removed footage for those frames, so leave those straight unless asked.
- The sound edit and caption timing stay where the words put them; the default offset is a third of a second and is limited by the footage beside each piece. fadeFrames 1 to 2 only for an audible click.
- Report the result's cuts and skippedCuts in a line; type none removes a split edit.
