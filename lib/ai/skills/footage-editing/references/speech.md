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
3. Read the cut back with readCutScript. It returns the surviving speech as prose, in timeline order, each sentence tagged with its timeline range, and hint flags: a word or phrase said again ("so so", a restarted phrase), a sentence said again in other words (retake), a clipped word, a half sentence, a long pause. Read the prose as the viewer will hear it: a point said more than once (a reworded retake is a repeat, the same as an exact one), a sentence started and abandoned, a line that makes no sense. Keep the last complete version of each point and cut the rest with readCutScript {drop:[{sentence, text?}], remove:[ids]} (one call; the later copy stays), move the edge its fix names for a clipped word or half sentence, accept a flag that is two different points, and read again until each point is said once. It is computed from saved word timings: never listen again or read frames for this.
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
- One setSplitEdits call, after the speech cut and any edge moves: it sets every cut on the layer (or `cuts` by timeline second), unlinks the affected picture from its sound and keeps both in sync. Never hand-build a split edit with unlink, trim, split or move.
- type auto (default) reads the word timings per cut: J where the next line starts on the cut, L where the outgoing line runs up to it; it skips cuts with silence on both sides or one continuous take. Name J or L only for the user's explicit choice.
- Use it when the user asks (J-cuts, L-cuts, smoother cuts, hide the jump cuts) or where a different shot meets a line: another speaker's clip handing off to the take, b-roll or a reaction under the end of a line. On a same-camera jump cut the picture shows removed footage for those frames, so leave those straight unless asked.
- The sound edit and caption timing stay where the words put them; the default offset is a third of a second and is limited by the footage beside each piece. fadeFrames 1 to 2 only for an audible click.
- Report the result's cuts and skippedCuts in a line; type none removes a split edit.

## Tool details
- retainSourceRanges: every kept piece starts and ends on a timeline frame and the pieces join with no gap; a measured edge moves at most half a frame. Without tightenSilence, edges round outward to project frames unless exactEdges:true; without a cleanup map, only the outer quiet edges are tightened, with 80 ms padding. A wordless leftover under 0.1 s is dropped with the slivers. A refusal names the range, the retained windows and what was removed. Inspect the actual retained ranges before adding subtitles. Missing source audio energy is backfilled locally without transcribing again.
- cleanSpeech: for chosen takes prefer retainSourceRanges with tightenSilence:true, which applies the same cleanup inside the kept ranges. Close gaps afterwards when other clips sat after it.
- readCutScript remove: the earlier copy goes, the later one stays. Flags inside a piece the cut did not touch are fixed only when the request asks to clean the speech; accept the others with a reason.
- setSplitEdits: J means the next line is heard while the previous picture holds, then the picture follows; L means the previous line carries on under the next picture. The default offset of 10 frames at 30 fps is 20 at 60 fps (a third of a second); under 3 frames (6 at 60 fps) is not heard. Each cut is limited by the pieces beside it and their source footage, so one short piece never fails the call. A sound edit that would clip a word moves to the word's edge when the other side is silent. fadeFrames never overlaps sound and never brings removed audio back.
- inspectAssetAnalysis: the default transcript gives sentence segments and a word-timing read hint; ranged reads return the exact samples of quiet intervals, tracking and beats. Source speaker IDs come from the diarized source transcript; window speaker IDs and faceIds are local to their window.
