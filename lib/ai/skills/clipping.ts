import type { EditorSkill, EditorSkillPage } from './index';

export const CLIPPING_SKILL_ROUTING = 'For finding or making short clips from a longer source, load readSkill name "clipping" before the work. Route by intent, including "clip this", "make clips", "turn this into shorts", "find the best moments", or a long stream, podcast or VOD link (Twitch, Kick, YouTube) with a short-form ask. A link alone is not a clipping request. Small edits to an existing clip follow scene-engine page "edit-lanes"; do not restart a whole-source search.';

const moments: EditorSkillPage = {
  name: 'moments',
  description: 'Scan the whole source, rank evidenced hooks and payoffs, and choose 15 to 60 second boundaries.',
  body: `# Finding moments for clipping

Use this search only for a clipping request. A local edit to an existing short follows scene-engine page \`edit-lanes\`.

## Scan once, reuse for every clip
Local facecam/speaker analysis and explicit pixel seeds work without Gemini. A Gemini video overview is skipped for meaningful speech; its transcript supplies content and timing. Only footage with little speech gets a background overview after the editor opens and transcription completes. Semantic inspection is optional when its provider works. Any unavailable overview (billing, key, quota, timeout or another failure) must not block a clipping job. Do not wait for or repeatedly request it, or report it as an editing failure. Use transcript evidence, readFrames, the moment map and source audio when it is unavailable. Never infer unseen events or emotions from motion/audio peaks alone.

### When Gemini is unavailable
HTTP 402 means provider billing/credits, not bad footage. It cannot succeed by retrying or changing the source window. inspectVideo/inspectFrames return available:false with the real reason and fallback instructions; these are unavailable evidence, never a passed visual check. Stop all further Gemini requests for this run, including other windows, inspectFrames, reference breakdowns and overview retries. Mention the limitation briefly and finish the requested clips from supported evidence.

Read the full saved transcript with inspectAssetAnalysis, including its audioActivity energy/peaks and quiet intervals. If missing, analyzeMedia mode "transcribe" measures those together; do it once. Request analyzeMedia mode "shots" only if measured scene cuts are missing: this runs local PySceneDetect without Gemini. Scan the whole source with readFrames momentsOnly:true, merge transcript hooks with audio peaks and scene cuts, then inspect candidate windows and the hook/payoff with readFrames itself. Those images are interpreted by you, without a Gemini call. Peaks and cuts locate candidates; verify visible action in the frames and spoken content in the transcript. Use fewer well-supported clips if needed. Continue local detectFacecam and build/verify each 15–60 s clip tab. Never stop at a list of candidates just because semantic video inspection is unavailable.

1. Inspect the source's saved analysis with inspectAssetAnalysis. If speech has no transcript, run analyzeMedia mode "transcribe" once, wait, then read it. Read the full transcript across the source, not just its opening or the first promising passage. Reuse saved scenes, audio activity and focus data. Request only missing analysis; never repeat it per clip.
2. Run readFrames momentsOnly:true from 0 to the source duration for visual activity and holds. It scans the whole source but returns at most 80 moments and holds; a quiet region or missing moment does not prove nothing happened. If the map saturates, inspect successive source windows so later or quieter sections are covered too.
3. Merge transcript hooks and quotes with reaction, hype, funny and action candidates from the moment map. Reuse saved scenes and local shot cuts for broad context when available; otherwise read source frames with readFrames and interpret them yourself. For a visual or audible event that needs meaning, optionally ask inspectVideo the actual clipping criteria in one candidate window up to 60 s. Wait for its result before asking another window. If available:false, use the fallback above for every remaining window. Audio activity and motion peaks suggest candidates; neither identifies laughter, emotion or a payoff by itself.
4. Confirm shortlisted visual moments with readFrames at fps 10 in short windows around the event. Read full-resolution frames or crops for framing details. Use targeted inspectVideo when judging a reaction needs its sound, and inspectAssetAnalysis for exact words. Never invent dialogue or rank a visual event from a peak alone.

## Rank, then cut
Give each candidate a title, SOURCE start/end, hook, payoff, evidence and a viral-potential score out of 100: hook 0/12/25 = absent/after setup/in first 2 s; payoff 0/12/25 = absent/implied/resolved; clarity 0/10/20 = prior clip required/one missing detail/self-contained; surprise 0/10/20 = absent/stated/visible reaction; quotability 0/5/10 = absent/context-dependent/standalone line. Cite source times. Scores are editorial estimates, never promised views. Prefer distinct moments over several overlapping versions of the same joke. Keep uncertainty visible; do not fill a requested count with unsupported highlights.

Each finished clip is 15 to 60 seconds. First sentence names its subject: “That’s why it failed” → retain “The upload stalled.” End after the payoff/reaction, before the reset. Read exact word timings around speech boundaries with inspectAssetAnalysis start/end or batched windows, preferably at most 30 s per window. Keep words and the thought complete, including the real reaction after a punchline. If a candidate cannot stand alone within 60 s, choose another or explain the constraint. Respect exact user timestamps and flag conflicts with the duration range. Recheck finished duration after any pacing changes.

Finding moments alone is an inspection request: return the ranked candidates without changing timelines. When clips are requested, carry the ranked plan into page \`batching\`.
`,
};

const framing: EditorSkillPage = {
  name: 'framing',
  description: 'Gaming facecam above gameplay, or speaker-led podcast and IRL reframing in 9:16, using measured existing tools.',
  body: `# Vertical framing

Use a vertical 9:16 canvas. Read the effects skill for framing controls. Reuse saved analysis across every clip. Source coordinates are normalized x/y/w/h rectangles, never preview-screen pixels.

## Gaming: creator above gameplay
Run detectFacecam once per source assetId: local MediaPipe faces plus OpenCV panel edges across native frames, without Gemini. It returns sampled source times, facecam PANEL and gameplay rectangles, confidence and kind overlay/creator-only/gameplay-only/uncertain. A face rectangle alone is not the webcam panel. Inspect readFrames at retained-range boundaries and layout changes; detection samples cannot prove intervening layout.

For a confident overlay, make two synchronized video instances from the same asset and SOURCE range on separate V layers. Keep one audible source track; mute the duplicate's linked audio. Call applyLayout layout "two-rows", detectedRegions:true, creator IDs in topClipIds and gameplay IDs in bottomClipIds. It uses detected source boxes and sets crop/transform together, without guessing coordinates or stretching. It refuses uncertain or changing saved layouts. Split at confirmed layout changes before applying each layout. cropClip remains available for a measured refinement; it masks source edges without recentering or enlarging them.

For creator-only or gameplay-only, keep one source filling the vertical frame with the supported crop. Do not build a duplicate empty row. For uncertain detection or odd/unbordered layouts with no clear panel, use followSubject mode "face" on the retained video, inspect the affected source range, and keep a stable wider view if no face is clear. Never invent a panel from the face box. Never report a low-confidence panel as certain.

## Podcasts, duo streams and IRL: follow the active speaker
For several people, use fitClip fit "cover" on the full-frame video, then call followSubject mode "active-speaker" on each retained video clip. It analyzes the retained SOURCE window, up to 120 source seconds, reusing current saved coverage and diarized Deepgram words when available. Only missing range audio is diarized. The media processor runs the visual analysis entirely on CPU, without Gemini or a GPU.

Camera shots come first: PySceneDetect finds cuts, and a clearly dominant visible face gets one fixed crop for that entire shot, including side-on views and microphones covering the mouth. This is a framing decision, not proof that the face owns the audio voice. Multi-face shots use mouth activity aggregated over whole diarization turns. Confident voice-to-face associations are remembered within the analyzed window; conservative appearance and position/size continuity let recurring faces reuse that association across later turns and shots. Short backchannels do not establish identities or trigger a switch. Competing, obscured and offscreen matches remain unresolved.

The crop holds a fixed face anchor within a shot, cuts immediately at camera cuts and eases only for confirmed speaker changes inside a shot. Uncertain intervals hold the current crop within the shot; an uncertain new shot starts from the stable center. If all intervals are uncertain, followSubject refuses to apply a crop. Turn following off and retain a wider view if the crop follows the wrong person.

Read the per-clip framing receipt: seconds and duration-weighted heuristic confidence for shot-dominant, turn-mouth, identity-reuse and fallback. Report fallback seconds explicitly. These scores are not calibrated probabilities and shot dominance does not verify a voice identity. inspectAssetAnalysis includes framing intervals with SOURCE start/end, shot, method, confidence, face and local faceId, alongside speakers.turns with speaker ID, face rectangle or null and matching confidence. Read around switches. Source speaker IDs come from the diarized source transcript; window speaker IDs and faceIds are local to that analysis window and must not be equated across separate windows. Never equate numeric voice IDs with real-world names.

Verify with getFrames at the hook, payoff, speaker switches and crop extremes. Faces, mouths, key action and any requested text must remain visible. Sample moving spans every 0.5 s; report sampled coverage and fallback seconds, never every-frame verification.
`,
};

const batching: EditorSkillPage = {
  name: 'batching',
  description: 'One project and shared source analysis, one titled timeline tab per clip, separate exports only when requested.',
  body: `# A batch of separate clips

One source, one project, shared assets and saved analysis. Never create a project or upload/transcribe the same source for each short. Reuse the current project when it contains the source. On MCP, use getProject and listTimelines first; createProject only if a project is needed. Bring a missing source in once with uploadMedia/finishUpload or importVideoLink and wait with getMediaTask. For a whole-source highlight search, import the full source rather than only the first candidate. Read source times from the imported asset: a ranged import starts at 0 at its original range start.

YouTube recordings and public media-file links are supported by the current importer. Twitch and Kick page links still trigger this skill but have no dedicated downloader here; request an uploaded recording or public media-file link if import is unavailable. Do not claim a live stream or unsupported page was imported.

1. Keep a batch plan with each title, SOURCE range, score and resulting timelineId. Inspect existing tabs on retries and resume completed work rather than duplicating it.
2. Use createTimeline from "blank", aspectRatio "vertical", name set to the clip title (up to 60 characters). One tab holds one short, starting at timeline 0. Use openTimeline to revisit an existing clip when the editing surface needs it. Preserve unrelated tabs and edits.
3. Add the chosen range with addMedia using the shared assetId, sourceStart, duration and start:0. Inspect the new clip IDs before reframing or optional polish. Each tab gets its own title, framing and requested finish, while source analysis stays shared.
4. On MCP, pass projectId and the intended timelineId explicitly to editing and inspection tools, including getFrames, so another session switching tabs cannot redirect work. Opening a tab changes what the user sees; prefer explicit timelineId for subsequent work.
5. Verify every tab separately with inspectTimeline and getFrames: 9:16, 15 to 60 s, hook through payoff, one intended audible mix, correct framing, no accidental gaps and a successful normalizeAudio result at the end of the mix. Follow page \`finishing\` for optional changes and their checks.
6. Export only when the user asks. Call exportVideo once per finished tab with its timelineId, then poll getExport for each job and label its download by title. Exports queue; listExports can show the batch. Never export the open tab repeatedly while assuming it selects different clips.

Timeline-tab management, imports and exports are available in both MCP and the in-app editing turn. In the app, editing tools act on the tab opened by createTimeline or openTimeline. Finish and verify each clip before switching tabs; tab changes publish its pending draft. Never call tab changes in parallel with edits. Do not substitute a montage in one tab or one project per clip. An optional overview can list title, source range, duration, score and tab/export link. Do not require approval of an overview before building requested clips.
`,
};

const finishing: EditorSkillPage = {
  name: 'finishing',
  description: 'Default social loudness plus optional captions, pacing, sound, hook text and niche styles, with restrained defaults and relevant checks.',
  body: `# Optional finish

Follow the clipper's explicit choices or selected style. Default: hook-to-payoff cuts, 9:16 framing, original audio at 1×, normalizeAudio to -14 LUFS/≤-1 dBTP. Captions, dead-air removal, speed-ups, zoom punches, hit effects, light music, hook text are optional. Do not force them into every clip or make their selection block delivery.

- **Captions and hook text:** read text-styling and footage-editing. Use saved word timings and addSubtitlesFromTranscript after final cuts. Hook text comes from the actual moment, without invented claims. Keep text clear of faces, essential gameplay and platform controls.
- **Pacing:** read footage-editing for speech cleanup and effects for zooms. Remove dead air or speed up only when requested or part of the selected style. Preserve comedic pauses, reactions and intelligible speech. Finalize timing before captions and overlays so they stay in sync. Check the final length remains 15 to 60 s.
- **Sound:** read music-and-sound. Keep speech and important game/room sound intelligible; add hit effects or light music only when requested or selected. Use getSound/checkSound to inspect the mix, setVolume to balance clips and configureAudio for fades or music ducking. After final timing, fades, ducking and mix choices, call normalizeAudio by default on each finished clip tab with no clipId: this normalizes the complete timeline mix to -14 LUFS integrated and at most -1 dBTP, including any music and effects. Pass clipId only when normalizing one linked sound clip is intended. The worker measures and verifies a two-pass normalization; preview and export use the same processed audio. Timeline normalization plays a verified master while preserving original editable sound. Later timing or mix changes automatically bypass the old master. Normalize again after those edits. Silence or failed measurement is not a successful normalized result. Respect an explicit request to preserve original loudness; use normalizeAudio enabled:false to remove an existing normalization when needed.
- **Niche styles when selected:** gaming favors the facecam/gameplay stack and the real reaction; podcast favors clear speaker turns and intact thoughts; IRL favors stable subject framing and situational context; sports favors the action and its outcome, with essential ball/player/score context visible. Apply only the chosen style's useful embellishments.

Use getFrames to check any added captions/text and the changed framing. Run checkPacing when building or changing motion, and checkSound when adding or changing sound; fix problems in the affected tab. Small follow-up edits to a finished clip start with scene-engine page \`edit-lanes\` and use its quick lane where applicable. Do not repeat whole-source discovery for a local caption, trim or style fix.
`,
};

export const clipping: EditorSkill = {
  name: 'clipping',
  description: 'Turn a long stream, VOD or podcast into separate vertical shorts: "clip this", "make clips", "turn this into shorts", "find the best moments", or a Twitch, Kick or YouTube source link with a short-form ask. Whole-source discovery, ranked hooks, 15 to 60 second clips, gaming facecam splits, speaker reframing and one timeline tab per clip. Small existing-clip edits use scene-engine page edit-lanes.',
  body: `# Clipping long sources into shorts

Scan the whole source with inspectAssetAnalysis and readFrames momentsOnly; rank hooks/payoffs with source evidence (moments). A link alone authorizes no clipping. User-chosen ranges skip rediscovery; find-only requests return candidates without edits.

Gemini is optional. If inspectVideo/inspectFrames return available:false (including HTTP 402 billing/credits), stop all Gemini requests in this run. Finish the clips using the full transcript, measured audio energy/peaks, local scene cuts (analyzeMedia mode "shots"), readFrames moment maps and candidate images. Read page moments for this fallback. Never treat unavailable semantic inspection as a failed clipping job or invent unsupported events.

Build 15–60 s shorts on one project/shared upload, one named 9:16 timeline tab each (batching). Pass timelineId explicitly on MCP; export each tab only when asked. Gaming puts creator above gameplay; podcasts/IRL follow confirmed speaker turns (framing). Verify measured crops and disclose fallback seconds.

Default: original audio/speed, normalized social loudness. Captions, pacing changes, effects, music and hook text require user/style choice (finishing). Existing local edits use getFrames at changed times ±1/fps (scene-engine/edit-lanes), without whole-source rediscovery.`,
  pages: [moments, framing, batching, finishing],
};
