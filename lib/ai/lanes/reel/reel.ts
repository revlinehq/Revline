import type { EditorSkill } from '../../skills/types';
export const reel: EditorSkill = {
  name: 'reel',
  description: 'Edit one talking-head take or rough cut into a reel: read it as a script, keep the intended script from its opening line to its closing line, remove mistakes and dead air, add minimal synchronized subtitles.',
  body: `# Reel
A good reel says the speaker's whole script, in order, from its real first line to its real last line, with the mistakes and dead air gone. "Edit my rough for a reel", "make this a reel" and "clean my rough cut" on one talking-head take all mean that: keep the intended script, remove false starts, repeated takes and pauses, tighten, add captions, vertical 9:16. Do not reorder or drop content unless the user asked or a stated length needs it. Separate highlights from long footage belong to clipping.

## Order of work
1. **Read the script.** inspectTimeline for the take's clip, then readScript {clipId}. It returns every spoken line with SOURCE times, marks setup and wrap-up talk as chatter and repeated lines as earlier takes, and suggests the opening line and closing line. Read all of it before deciding anything. No cut, split or trim comes before this.
2. **Understand it.** Work out what the piece is about in one line and its beats in order: hook, points, tangents, payoff, call to action.
   - The script BEGINS at the first intended line. "Okay", mic checks, "is this recording" and restarted attempts come before it. When a line is tried several times, the last complete take is the one to keep, unless an earlier take is complete and the last one is not (keepLines).
   - The script ENDS at the last intended line, before "cut", "that's it" and talk to the camera operator.
   - The marks are measured suggestions. A hook that sounds like chatter ("Wait, you're still doing this?") is still the hook: start earlier than the suggestion whenever the line belongs to the script.
3. **Plan and restate.** planScript {clipId, about, beats}: every script line belongs to a beat, each with a priority (1 must keep, 3 first to drop). In the same step tell the user in one line what you will do, from readScript's restatement: "I'll keep your script from '<opening words>' to '<closing words>', remove N false starts, target about X s."
   - Length: with no stated length, keep every beat; the script sets the duration. With a stated length (say 40 to 50 s), set keep:false on whole lower-priority beats, tangents and redundant takes until planScript's estimate fits. Never trim the opening, the payoff or part of a sentence to fit. If it cannot fit, keep opening and payoff and tell the user the real length.
   - Start somewhere else or stop early only when the user asked (openingReason, endingReason hold their words).
   - Two different complete openings (readScript twoOpenings): ask with askUser, the two lines as options, unless the request already chose. Ask nothing else.
4. **Cut once.** retainSourceRanges with the ranges planScript returned, unchanged, and tightenSilence:true. That one call keeps the chosen lines, removes pauses, breaths and fillers inside them and keeps word edges clean. Do not run cleanSpeech over the same take afterwards, and do not rebuild the cut with split, trim and delete chains.
5. **Captions.** One vertical timeline unless the user chose another format. Add phrase subtitles once with addSubtitlesFromTranscript: minimal static text, a subtle outline or shadow if needed, NO background. Respect explicit no-captions and any requested styling; keep existing caption styling and never duplicate subtitles.
6. **finish.** It checks the cut against the saved plan: starts on the opening line, ends on the closing line, no sentence cut partway, no line kept twice, requested length met, captions in sync. Repair what it names and call it again.

## Follow-ups and details
- A later request on the cut reel (shorter, drop a point, restore a line) starts again from readScript and planScript, so the new cut is checked the same way. Drop whole beats; never shave the opening.
- Awkward looks, looking away or visible retake transitions: start with one readFrames grid (count:12, stillsOnly:true) across the source, then short 0.3–0.5 s SOURCE sequences around the proposed joins (up to 30 explicit times, stillsOnly:true). Trim only with visual evidence and intact speech. Transcript-only requests skip this.
- Smoother joins: setSplitEdits with subtle 0.1–0.2 s J/L picture offsets only where source handles and inspected context support them. Keep visible speaking mouths in sync; no audio crossfades or invented room tone.
- Keep source framing and audio unless a change is requested or the aspect ratio needs it. Music, punch-ins and normalization are optional. Supporting motion or sound uses only the relevant loaded skill and never replaces this deliverable.
- Checks: inspectTimeline data and finish cover retained ranges, duration, gaps, linked audio and caption sync. Sample new or changed caption styling or framing once with getFrames; no per-cut or per-caption renders. Use getSound only for an uncertain short join. A requested export, publish or full double-check renders every changed range instead. Report only checks actually performed. After three failed finish checks report the remaining failures honestly.`,
};
