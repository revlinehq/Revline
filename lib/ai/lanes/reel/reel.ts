import type { EditorSkill } from '../../skills';
export const reel: EditorSkill = {
  name: 'reel',
  description:
    'Turn talking-head or raw footage into one 30–60 second vertical reel.',
  body: `# Reel
1. Inspect the timeline and source transcript. Run analyzeMedia transcribe if needed. Identify the opening hook, complete thought and ending from actual words.
2. Keep the best takes and remove dead air using saved speech/audio activity. Put speech at the start; retain natural word boundaries and breath.
3. Build one 30–60 second 9:16 timeline. Add captions with addSubtitlesFromTranscript so their timing follows retained source speech. Correct words only from transcript evidence.
4. Use deliberate punch-ins and supplied b-roll to support the spoken point. Add music only when requested or already authorized; duck it under voice.
5. Normalize the final mix with normalizeAudio (target -14 LUFS, ceiling -1 dBFS). Inspect rendered captions and framing, then call finish. Repair reported failures; after three failed checks report the exact remaining failures.`,
};
