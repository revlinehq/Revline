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
3. Read the cut back once with readCutScript. It returns the surviving words in timeline order with a mark at every cut and flags what a listener would hear: a word or phrase said again right after ("so so", a restarted phrase), a clipped word, a half sentence, a long pause. Cut the flagged repeats and false starts out with readCutScript {remove:[ids]} (one call; the later copy stays), move the edge its fix names for a clipped word or half sentence, and accept only a repeat the speaker meant. It is computed from saved word timings: never listen again or read frames for this.
4. Join the pieces: closeGaps for footage with no timed overlays; for layered edits, follow footage-editing page `edit-lanes` to keep overlays in sync.

## Rules
- Trimming, cutting, choosing takes and removing repeats, fillers or pauses are transcript-and-audio edits: never call inspectVideo or inspectFrames for them.
- Look at the picture only when the request asks for a visual judgement, such as eyes-to-camera cuts, awkward look-ups or script glances. Then read the visual-inspection skill first.
- A visual cue tied to a spoken moment ("when I point", "timed to the gesture"): cut first, find the phrase in the transcript, then read frames only in a window of a second or two around it.
- A short-form deliverable alone does not justify viewing the footage.
- Keep natural pauses (keepPauses:true) only when the user asks for them; exact user timestamps are cut without tightening.
- Use saved shot boundaries for existing cut points and transcript word timings for speech cuts.
- Request word-timed transcription when the user needs captions or edits at specific spoken words; request beat analysis only when the edit needs measured music timing.
- For a new visual question (a fight, a reaction, an object), call inspectVideo with the user's actual question and an optional source window. A saved overview does not answer it.
- Never invent unseen events or spoken words.
- Listen only to an uncertain short join or an actual audio problem.

## J and L cuts
- Use setSplitEdits selectively, where a different shot makes a speech join smoother: J-cut (kind J, 0.1–0.2 s, the next line's sound leads the picture) the join from an opening clip into the take; L-cut where b-roll or a reaction shot lands under the end of a line.
- Keep visible speaking mouths in sync: a same-camera talking-head jump cut stays a straight cut unless the user asks for J-cuts, because the picture would show removed footage under the next line.
- Never apply J/L to every cut or alternate them mechanically.
- Do them last, after the cut, layers and any edge moves: they unlink picture from sound. Each edit names the video clip BEFORE the cut; batch all chosen edges in one call after inspectTimeline.
- Keep speech audio and caption timing unchanged; never repeat words or fabricate room tone.
- Follow the user's explicit cut preferences.
