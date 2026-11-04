import type { EditorSkill } from '../../skills';
export const reel: EditorSkill = {
  name: 'reel',
  description: 'Clean one talking-head take into a coherent short-form reel, with minimal synchronized subtitles by default.',
  body: `# Reel
Use this workflow by default for "make a short form/reel out of this" with one talking-head take, unless the user explicitly chose another style. Separate highlights from long footage belong to clipping.
1. Inspect the timeline and saved source analysis first. Reuse transcripts, word timing, speech cleanup and audio activity/preparation already present. Request only missing analysis; do not repeat heavy whole-film analysis or normalization.
2. Read the actual words and listen only to uncertain short ranges. Remove false starts, abandoned takes, accidental repeated words/phrases and awkward pauses. Use cleanSpeech suggestions and retainSourceRanges for evidence-backed source edits, retaining linked audio/video. Preserve natural breaths, delivery, intentional emphasis/repetition and the coherent full meaning. Do not mechanically remove every repeated token or every silence. Keep clean word boundaries.
3. When awkward looks, looking away or retake transitions matter, inspect only the relevant short visual windows with inspectVideo/readFrames. Trim them only when actual visual evidence supports it and speech continuity survives. Do not infer facial behavior from transcript text or stills alone.
4. Build one vertical timeline unless the user specified another format. Let the retained complete message determine its duration. Do not force 30–60 seconds, pad a short idea or cut a full thought to meet a preset.
5. Add readable phrase subtitles from retained measured speech with addSubtitlesFromTranscript by default. Use minimal static text, a subtle outline/shadow if needed, and NO background. Respect explicit no-captions and any requested background, typography or animation. Preserve existing caption styling unless asked to change it; do not duplicate existing subtitles.
6. Keep source framing and audio unless changes are requested or needed for the chosen aspect ratio. Supporting motion or sound uses only the relevant loaded skill and never replaces this deliverable. Music, decorative punch-ins and normalization are optional, not compulsory.
7. Verify changed caption/framing/cut ranges, reusing completed checks and preparation. No repeated heavy full-film checks. Call finish and report only actual performed checks/results. After three failed finish checks report the remaining failures honestly.`,
};
