---
name: "clipping"
description: "Turns a long stream, VOD or podcast into separate 15 to 60 second shorts, one timeline tab per short. Read it for \"clip this\", \"make clips\", \"turn this into shorts\", \"find the best moments\", or a Twitch, Kick or YouTube link with a short-form ask."
---
# Clipping long sources into shorts

A good batch is a few distinct, self-contained shorts, each opening on its hook and ending after its payoff, with every claim backed by saved transcript or observed video.
Each short lives in its own titled tab of one shared project, keeps the source framing and audio, and is closed out with cheap data checks rather than heavy QA.

## Workflow
1. Read page moments, then call findHighlights on the shared source.
2. Pick the evidence path by the requested content, not by voice presence:
   - Podcast, interview, talk or requested stream dialogue: speech-led (speechLed:true), judged from the saved transcript.
   - Gaming, sports and other action: visual events judged from short inspectVideo windows; commentary over the action does not make the visuals irrelevant.
   - Silent content: bounded video discovery across the source, with honest inspected coverage.
3. Rank candidates and register them with planClips (page moments).
4. Read page batching, then build one populated tab per accepted candidate.
5. Reframe (page framing) only when the user requests vertical reframing or a speaker crop; add finishing (page finishing) only when requested or part of the selected style.
6. Call finishClipping, then finish. Export only when the user asks.

## Defaults
| Setting | Default |
|---|---|
| Short length | 15–60 s |
| Shorts per source | min(10, qualifying distinct moments, max(3, round(sourceSeconds / 150))), within free tab slots |
| Qualifying score | 65/100 or higher (rubric in page moments) |
| Framing and aspect | Source framing and aspect |
| Audio | Original audio at 1×, original loudness |
| QA | finishClipping's inline data checks only |

## Rules
- Change framing, aspect or loudness only when the user asks, for every kind of source, gaming and action included.
- Heavy QA is optional for every kind of clipping: use checkClip only for the user's stated concern.
- Do not run checkPacing, 10 fps windows or getFrames sweeps on finished shorts.
- Never claim a skipped check passed or that an unsupported action was observed.
- Finding moments alone is an inspection request: return the ranked candidates without changing timelines.
- A small follow-up edit to a finished short (caption, trim, style) starts with writing-scenes page edit-lanes and uses its local checks where they apply; do not repeat whole-source discovery for it.

## Example
"Clip this" on a 45-minute podcast:
- Speech-led, so the moments come from the saved transcript with no video judging.
- 14 candidates score 65 or higher. The count is min(10, 14, max(3, round(2700 / 150) = 18)) = 10 shorts.
- planClips accepts those 10 and drops every other returned candidate with a reason ("same payoff as H3", "needs prior context").
- Each short gets its own titled tab starting at 0, in the source framing with the original audio.
- finishClipping, then finish. No export until the user asks.

## Pages
- moments: discover, rank and register candidates; choose clean 15–60 s boundaries.
- batching: one project and shared source, one titled tab per short, exports on request.
- framing: facecam-over-gameplay stacks and speaker reframing in 9:16, only when requested or needed.
- finishing: optional captions, pacing, sound and niche styles, with the clipper caption defaults.
