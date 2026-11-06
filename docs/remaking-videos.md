# Reference footage

Drop any video into the editor chat (an edited video, raw footage, someone's launch film). The agent breaks it down shot by shot and part by part, then either **remakes** it or **borrows its style** for parts you point at ("this transition, this title style, this pacing").

## What already exists (and gets reused)

| Piece | Where | What it gives us |
| --- | --- | --- |
| Chat attachments | `attachedAssetIds` on `assistant.send`, checked in `convex/lib/editorTurn.ts` | Dropping a file in the composer already uploads it and tells the turn which asset it is. |
| Measured cuts | `shots` media task, `scripts/detect-shots.py` (PySceneDetect `AdaptiveDetector`) | Frame-exact hard-cut boundaries. Not exposed as an agent mode today. |
| Music beats | `beats` mode, Beat This model | BPM, beats, downbeats, accents, drops. |
| Overview | `understand` mode, Gemini native video | Summary and rough scenes. Too coarse for a breakdown. |
| Focused questions | `inspectVideo` (Gemini agentic, up to ~60 s windows), `inspectFrames` (up to 12 decoded frames, 3 s) | Precise looks at one moment, with boxes. |
| Our own output | `getFrames` | Renders our timeline, so a remake can be compared against the reference. |
| Style language | `lib/ai/skills/launch-films-motions` | Directions written as five lines (look, type, product UI, motion, pacing), plus techniques with durations and eases. |

So the new work is one new analysis mode, one stored shape, one read tool, one chat card, and skill guidance. No new provider.

## 1. How the frame watcher samples shots

New analysis mode **`reference`**, run on the media worker like `understand`:

1. **Cuts first, measured.** Run `detectShots`. This gives every hard cut at the frame. Gemini never decides where hard cuts are.
2. **Soft transitions.** A dissolve, wipe or blur-through often reads as no cut, or as two cuts a few frames apart. Where two boundaries sit under ~0.8 s apart, or a shot is under ~0.3 s, mark the span as a *transition candidate*.
3. **Keyframes per shot.** For each shot, decode 3 frames (just after the in point, the middle, just before the out point). Shots over 4 s get one more frame per 2 s, up to 6. Transition candidates get 4 consecutive frames across the span. Total cap is about 120 frames. Long films are batched in groups of shots.
4. **Beats.** If the file has audio, run `beats` too and keep the result.

## 2. What it detects, and how

One Gemini pass per batch of shots. Its input is the native video (static processing for files up to 5 min) **plus** the measured cut list **plus** the labeled keyframes. The prompt asks for structured JSON, one entry per measured shot (the shot ids are given; it may not add or merge shots):

- **Transition in:** hard cut, dissolve, blur, whip, zoom-through, wipe (with direction), match cut, or flash. Also the approximate duration.
- **Camera:** static, push in, pull out, pan, tilt, orbit, or handheld; rough speed; ease feel (linear, ease-out, snappy/expo).
- **Title style** (when there is on-screen text): role (headline, caption, label), size as % of frame height, weight, case, font class (grotesk, serif, mono, display), alignment and position, how it enters (typing, blur-in, word reveal, slide, scale), its hold, and how it exits. The text is stored only so you can recognise the shot; it is never reused.
- **Timing:** comes from the measured cuts. Shot length, and cut-on-beat (does this cut land within ~80 ms of a beat or downbeat).
- **Look:** background, dominant palette (3 to 5 hex), grain or texture, depth (flat, blurred layers, 3D tilt).

Numbers such as durations and on-beat ratios are always computed by us from measured data. Gemini gives only labels and descriptions, and is asked to state its uncertainty, as the existing inspection prompts already do.

## 3. Breaking each screen into parts

Each shot also gets a **parts** list, the way the launch-film breakdowns separate a screen:

```
S4 (6.20 to 8.05 s, 1.85 s, hard cut on downbeat)
  background  near-black, soft vignette
  ui          chat composer, front-on, cropped to the input row, 70% width
  title       "..." small grotesk, 5% height, blur-in 0.4 s, centered low
  cursor      none (interaction by typing)
  logo        none
  motion      slow push in, about 4% over the shot
```

Each part has a `kind` (background, ui, title, caption, logo, product, person, cursor, shape, emoji or sticker, overlay), a short description, a rough normalized box from the middle keyframe, and how it moves (enter, hold, exit). Part ids are stable, like `S4.title` and `S4.ui`.

## 4. The stored style reference

It is saved on the asset's analysis as `analysis.reference`, versioned, and shared through `assetAnalyses` like the other modes:

```ts
reference: {
  version: 1,
  duration, fps, aspect,
  shots: [{ id: 'S1', start, end, transitionIn, camera, look, parts: [...], titles: [...], onBeat?: boolean }],
  rhythm: { medianShot, shortestShot, longestShot, cutsPerMinute, onBeatRatio?, bpm? },
  direction: { look, type, productUi, motion, pacing },   // the five launch-films-motions lines, written from the shots
  signatures: [{ id: 'T1', kind: 'transition' | 'title' | 'camera' | 'pacing', shotIds: ['S3','S7'], recipe }]
}
```

`signatures` are the repeated moves worth borrowing, for example "every title blurs in for 0.4 s and holds 1.2 s", or "a whip right on each downbeat". Each comes with a concrete recipe written in our controls: a transition preset and duration, a GSAP ease and timing, a camera move.

## 5. How the user points at moments ("this and this")

- **The chat card.** When the analysis lands, the chat shows a breakdown card: a row of shot thumbnails labeled S1, S2 and so on, with timing. Opening a shot shows its parts as chips (`S4.title`, `S4.ui`, `S4 transition`). Clicking a chip adds it to the composer as a reference token. You can also scrub the card's mini player and click "this moment". That adds `S4 @ 7.1s`.
- **Plain words still work.** "the title at 0:07", "the second transition", "the pacing of the intro". The agent resolves them against the stored shots with the new **`inspectReference`** read tool (by shot id, part id, time or kind). If a match is unclear, it calls `inspectFrames` on that window.
- The agent repeats back what it understood, by id, before it builds.

## 6. Remake vs style transfer, mapped onto scene code and the timeline

The reference file never goes on the timeline. It stays in project media and is tagged as a reference.

**Remake:** the same structure and motion, rebuilt with *your* content.
- Each shot becomes one timeline segment of the same length. If you have footage, that is your footage, picked to match. If not, it is a scene (`addScene` per shot, or one scene with internal beats when shots share a UI build).
- Each part maps to scene code. `ui` becomes your product UI rebuilt from your brand-kit blueprint (never the reference's UI). `title` keeps the measured size, entrance, ease and hold, with copy written for your product. `background` and `look` come from the brand kit, with the reference palette used only as a guide for mood.
- Transitions map to `addTransition` presets with the measured duration. Camera moves map to `configureCameraMotion` or GSAP inside the scene. Cuts are snapped to the beats of your music with `alignCutsToBeat` when the reference cut on beat.
- After it is built, `getFrames` at each shot's middle, compared with the reference keyframes, checks the build.
- The launch-films-motions rule stays: never copy the reference's copy, logo, product, characters or exact layout. A remake copies the *edit* (structure, timing, motion, type behaviour), not the content.

**Style transfer:** only the parts you pointed at, applied to the current edit.
- `S4 transition` → the same preset and duration on the cuts you name, or on all of them if you say so.
- `S4.title` → its type behaviour applied to your titles: `applyTextLook` or `setTextAnimation` for text clips, and an `editScene` change of the title's CSS and GSAP inside scenes.
- `pacing` → the shot-length profile and on-beat ratio applied to your cuts (trim, `alignCutsToBeat`).
- `direction` → used as the film's style direction in the launch-films-motions flow (step 5), in place of an example direction.
- The "feedback on one part" rule applies: only the named parts change.

## Build order

1. `reference` analysis mode: worker pipeline, schema, `analysis.reference`, `analyzeMedia` mode `reference`.
2. `inspectReference` tool and the skill page (`launch-films-motions` → `reference` page: remake vs style rules).
3. Turn wiring: an attached video plus a reference-style request triggers the breakdown; the reference stays off the timeline.
4. Chat breakdown card with shot strip, part chips and composer tokens.
5. Verify in the dev editor: drop a launch film, read the breakdown, run a remake and a single-part style borrow, check with `getFrames`.

## Decisions (from review)

- No salute emoji. It was not part of this feature.
- A remake depends on what the reference is. References are already-edited videos (Instagram edits, motivation videos, brand launch films), so the breakdown classifies a genre and the `remaking-videos` skill has a page for each: `social-edit` (the user's footage cut to their music on the reference's rhythm), `motivation` (the user's voice and footage, the reference's caption style and pacing), `launch-film` (launch-films-motions scenes for the user's brand), plus `borrow` for single parts.
- When a remake needs material the project does not have, the agent lists what each shot needs and asks.
- Pointing at moments: the chat card's shot strip, part chips and "this moment" chip, plus plain words resolved by `inspectReference`.

## As built

- `lib/media-analysis/reference.ts`: keyframe sampling, prompt and schema, parsing, and rhythm measured from shots and beats.
- `lib/media-analysis/gemini.ts` `breakDownReference`; `lib/server/media-task-runner.ts` `reference` task (shots, beats, keyframes, one Gemini pass).
- Stored as `analysis.reference` (validated JSON) next to `shots` and `beats`.
- Tools: `analyzeMedia` mode `reference`, `inspectReference`.
- Skill: `lib/ai/skills/remaking-videos.ts`.
- Card: `components/editor/reference-card.tsx`.
