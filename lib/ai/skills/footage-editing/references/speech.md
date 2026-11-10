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
- Use setSplitEdits selectively, where source handles and inspected context (b-roll, a reaction shot) make a speech join smoother.
- Keep visible speaking mouths in sync: a same-camera talking-head jump cut stays a straight cut.
- Never apply J/L to every cut or alternate them mechanically.
- Batch all chosen edges in one call after inspectTimeline.
- Keep speech audio and caption timing unchanged; never repeat words or fabricate room tone.
- Follow the user's explicit cut preferences.
