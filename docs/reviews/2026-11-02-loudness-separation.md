# Loudness and audio separation investigation

Status: investigation only. No runtime fix was made, and normalization followed
by stem separation, or the reverse order, has not been verified.

## Source findings

The investigation started at `002ae70`, the common base of `loudness-separation`
and `origin/main`. Neither that source nor the development MCP tool catalog
contained a voice/background stem separation tool or processor path. The later
rebase onto `f8433b0` did not add one.

- `normalizeAudio` in `convex/lib/editorToolkit.ts` asks the media worker to
  normalize a clip or timeline, then saves the returned audio asset and a mix
  signature in `clip.normalizedAudio` or `timeline.audioNormalization`.
- `lib/server/normalize-audio.ts` measures the retained mix, applies two-pass
  loudness normalization and measures the stored PCM output.
- `resolvedAudioTimeline` in `lib/editor/audio-normalization.ts` selects a
  normalized WAV while its signature matches the authored mix. Preview,
  `getSound`/`checkSound` and export share this projection. Mix changes bypass
  a stale bake until normalization is run again.
- `separateVideoClips` in `lib/editor/operations.ts` gives a video's extracted
  source audio its own linked clip and mutes the video. This is full audio
  extraction, not separation into voice and game/music stems.

The reported order-dependent loss of normalization could not be reproduced
without the stem separation implementation. Its root cause remains unconfirmed.

## Development measurements

Development deployment: `majestic-alpaca-541`.

The original project, `Test: stream clips`
(`j971171368j66yhvhxj7w2er7d8he4qh`), was preserved. `duplicateProject` created
[Loudness separation verification](http://localhost:3001/editor/j9772cs4frw433g8par0gvcgns8hfcpg).
All audio edits and measurements used that copy, explicitly targeting timeline
`838a4993-cfdd-4ca9-9f1f-8c1931192f2f`, clip 2, timeline seconds 0 to 20.

The development MCP tools were invoked through `mcpActions:callTool` using the
Convex CLI. Normalization was disabled on the copy to measure the source, then
run again with a target of -14 LUFS and a true-peak ceiling of -1 dBTP.

| Measurement | Integrated loudness | Peak |
| --- | --- | --- |
| Original audio, `getSound` | -25.1 LUFS | -11.9 dBFS |
| Normalization input, worker measurement | -25.02 LUFS | Not recorded |
| Stored normalized PCM, worker measurement | -14.27 LUFS | -1.45 dBTP |
| Normalized playback mix, `getSound` | -14.4 LUFS | -1.5 dBFS |

The final `inspectTimeline` reported an active normalized master and no visual
coverage gaps, same-layer overlaps or missing media references. An intermediate
`getSound` call hit the worker's temporary disk-space limit. After removing
dependencies installed for this worktree to free space, the retry succeeded and
returned the normalized playback measurement above.

These results confirm normalization and playback of this copied timeline. They
do not establish that normalization composes with stem separation. Export was
reviewed in source only; no export or deployment was performed, and the existing
3001 development server was not restarted.

## Follow-ups

1. Identify the branch or commit containing the voice/background stem separation
   implementation and reproduce the level drop there.
2. Preserve normalization through that path, then measure both operation orders
   on a disposable copy using `getSound` or `checkSound`.
3. Arrange development synchronization before verifying a changed Convex path.
   No backend code was synchronized during this investigation because deployment
   was prohibited.
