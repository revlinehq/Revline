# Revline features

Source material for the marketing page. Each feature has a short pitch, what it actually does, and a status:

- **Live**: shipped and available to users today.
- **Built, not exposed**: the engine exists in the code but users cannot reach it yet.
- **In progress**: works, but needs corrections before we promote it.
- **Paused**: implemented behind a plan or flag that is switched off.

Keep this file factual. Update the status when something ships, and do not promote anything below "Live" as available.

---

## Flagship engines

### Speech cleanup engine

**Pitch:** Cut the ums, breaths and retakes in one pass, at the millisecond. Every cut lands between words, never inside one.

**What it does** (`lib/speech-cleanup/`, tool `cleanSpeech`):

- **Layers of detection**, each in source time:
  1. **Filler words** from a verbatim transcript ("um", "uh", "erm", "hmm"), cut by their own timestamps.
  2. **The audio is the authority.** Every 10 ms frame is measured (loudness, voicing, pitch, zero-crossing rate, spectral change) and labelled silence, breath, held sound ("uhhh", "mmm") or speech. Silence is calibrated to each recording: anything 25 dB under its speech level, so room tone and hiss count as empty air. Any silence of 150 ms or more is removed wherever it is, even where a transcriber stretched a word over it. Transcripts pad word times, so the engine only uses them to know what was said, never where sound starts or stops.
  3. **Stutters**: "in the short, in the short term" keeps only the final attempt. The repeat must cover at least 75% of the abandoned words, so "low effort content attracts low effort viewers" is left alone.
  4. **Retakes across sentences**: a line re-recorded up to a minute later, even reworded slightly, keeps only the last full take. False starts ("In a short time, / in a short time, you're getting…") and lines cut off mid-sentence are dropped too.
- **Joins that sound continuous.** It measures where each word's sound starts and where its decay ends. Every kept piece is snapped to those edges, about 30 ms before the first word and 50 ms after the last, so a cut never carries room tone or a detached breath, and never clips a word's tail.
- **Confidence on every cut.** Each cut carries a 0–1 confidence and a reason (pause, breath, filler, restart), so an editor or the AI can skip uncertain ones.
- **Automatic.** Every speech cut Revline makes runs the cleanup inside the kept sentences and snaps edges to measured word sound, to the millisecond. Nobody has to ask for it; the chat says what it removed ("removed 31 pauses, 12.5 s"). Saying "keep my natural pauses" turns it off for that edit.
- **Two ways to use it:**
  - Clean a whole clip in one call.
  - Pass the sentences the AI chose to keep; the engine then sets every boundary. Choosing between differently worded takes stays an editorial decision for the AI.
- **Fast:** about 2 seconds for 5 minutes of speech. Measured once per source and saved with the transcript.

**Status:** Built. It runs in the development media worker and is exposed as `cleanSpeech` to the chat editor and MCP. Production follows the next media-processor release.

**Marketing angles:**

- "Your best take, automatically."
- Clean cuts that do not sound cut.

### Deepgram transcription

**Pitch:** Word-perfect captions and cuts, timed to the millisecond.

**What it does** (`lib/media-analysis/deepgram.ts`):

- **Model:** Deepgram Nova-3 transcribes the whole source in one request, with smart formatting, punctuation and automatic language detection.
- **Keeps every retake** and gives each word tight start and end times, so captions and speech cuts line up with the audio.
- **Keeps filler words** with their own times, which feeds the speech cleanup engine.
- **Replaces Whisper.** Whisper stretched word times over pauses and fillers, and that put cuts mid-word. Older transcripts are redone with Deepgram on their next use.
- **Limits:** up to 5,000 words per source. Saved per asset and reused, so the same footage is never transcribed twice.

**Status:** Live in development. Production switches over with the next media-processor release.

### Frame understanding engine

**Pitch:** Revline watches your footage. Ask what happens and where, and it finds the moment and the object.

**What it does** (`lib/media-analysis/`, `lib/server/media-task-runner.ts`; Gemini 3.7 Flash):

- **Footage overview:** a summary plus up to 100 scored scenes. "Use the strongest moment" picks the best one.
- **Video questions:** ask about the footage and get an answer with matching time windows mapped onto the timeline, plus how sure it is.
- **Frame inspection:** looks at up to 12 frames from a 3-second window and returns labelled targets with confidence and a bounding box. Zoom and camera tools can then aim at that exact object ("zoom into the laptop screen").
- **Render review:** after an effect is applied, the AI renders the result and checks it against its plan before it reports back.
- **Supporting analysis:**
  - Shot detection with PySceneDetect.
  - Face tracking with MediaPipe for follow-the-subject framing.
  - Music beat detection with the beat_this model.

**Status:** In progress. It works end to end, but localisation and timing answers need corrections before we promote precision claims.

### Motion design

**Pitch:** Motion graphics from a sentence. Animated titles, kinetic captions and smooth camera moves, all editable on the timeline.

**What it does:**

- **18 text animations** (`lib/editor/text-effects.ts`, `lib/editor/remotion-text.ts`):
  - Basic: none, fade, rise, pop.
  - Templates: Word reveal, Pop-in words, Sliding title, Karaoke (follows spoken word timing), Neon echo, Lyric slam, Kinetic stack, Chromatic split, Outline trails, Cinematic focus, Character scramble, Spotlight sweep, Ink write-on, Echo tunnel.
  - The expressive ones have strength, reveal duration and stagger controls.
- **Typography:**
  - 18 fonts, including Inter, Anton, Bebas Neue, TikTok Sans, Montserrat, Playfair Display and Caveat.
  - 6 text looks: Default, Bold, Boxed, Highlight, Difference, Neon Echo.
  - Stroke, shadow and glow, plus gradient fills (2–5 colours, any angle, optionally animated).
  - One caption's style can be copied to all captions.
- **Keyframe animation** for text, images and solid colours: position, scale, opacity, rotation and brightness. Easings are linear, ease-in-out, ease-out and focused-spring. Manual editor: `components/editor/motion-keyframe-editor.tsx`.
- **Camera moves:**
  - Smooth zooms: zoom in, hold, return.
  - Keyframed camera paths, from 2 to 8 points, in glide or follow mode, with optional motion blur.
  - Subject-following crop.
  - Subtle punch-ins between cuts.
- **Explainer scenes:** the AI writes animated React scenes up to 120 s long, compiled and played inside the editor (`addScene`).
- **Layout and blending:**
  - Two-row split-screen layout.
  - 6 blend modes: normal, screen, multiply, overlay, add light, difference.

**Status:** Live. Per-user style generation is planned (see [future features](future-features.md)).

---

## AI editing

### Chat editor

**Pitch:** Describe the edit; watch it happen.

- **74 structured editing tools** act on the real timeline. The preview updates after every saved edit, and every AI edit can be undone.
- **Models:**
  - GPT-6.1 Sol, GPT-6 Astra and GPT-6.1 Terra (default in production).
  - Claude Sonnet 5.5 and Opus 5.5 when they are configured.
  - Reasoning levels from low to max.
- **Queueing:** messages sent while an edit runs are queued, and Stop cancels without losing saved work.
- **Effect review loop:** the AI plans an effect, renders it, and checks the result before it reports back.
- **Skills:** effects and styling, explainer scenes, music beats, sound design, visual inspection.

**Status:** Live. Manual model choice and Fast mode are Paused (Ultra).

### Edit from Claude, ChatGPT, Codex or Cursor (MCP)

**Pitch:** Your AI assistant can now edit video. Connect Revline to Claude Code, Claude, ChatGPT, Codex or Cursor and let it cut, caption and export for you.

- **Remote MCP server** with OAuth 2.1 sign-in (PKCE, dynamic client registration), so no keys are pasted anywhere.
- **About 90 tools:**
  - Projects: create, rename, duplicate, delete.
  - Uploads, plus import from YouTube links.
  - Timeline tabs.
  - Every editing tool.
  - Frame previews with `getFrames`.
  - Exports and the export queue.
- **Live status in the editor:** a calm "Connected through MCP" notice shows the agent's logo (Claude or OpenAI) and the MCP mark, for as long as the agent is working. Your own chat input stays locked so you do not edit over each other, and the edits appear live in any open tab.

**Status:** Live (Pro plan).

---

## Editing

### Timeline

- **Layers:** a custom multi-layer timeline with up to 24 visual layers and 12 audio layers.
- **Selection and editing:** clip and marquee selection, multi-clip moves, trims, frame-snapped splits, and copy and paste with linked audio.
- **Markers:** beat and timeline markers that clips snap to.
- **Undo:** application undo, shared between manual and AI edits.
- **Canvas:** on-canvas move and resize, plus crop, fit or fill, rotation and opacity.
- **Aspect ratios:** 9:16, 1:1 and 16:9 in the menu (4:5 and 4:3 are also supported).

### J and L cuts

**Pitch:** Cuts that feel edited by a pro. Let a line's sound lead into the next shot, or carry over it.

- **J cut:** the next line's sound starts while the previous picture is still on screen, then the picture follows.
- **L cut:** the sound carries over while the picture changes early.
- **Sound never moves.** Only the picture edit point slides, using the footage beside each piece, so speech cleanup, millisecond edges and captions stay exactly in place.
- One request can set J/L cuts on every cut in a video ("add J and L cuts", "smoother cuts").

**Status:** Built. Running locally; production follows the next release.

### Timeline tabs

**Pitch:** Many videos, one project. Cut the short, the teaser and the long version side by side from the same footage.

- **Each tab is its own timeline**, and switching is instant.
- **Batch export:** export several tabs in one go and follow their progress together.

**Status:** Live.

### Captions and subtitles

- **Automatic subtitles:** generated from word-timed transcripts in phrases of up to six words.
- **Speech-synced highlights**, including karaoke.
- **Styling:** fully styleable (font, weight, colour, background, stroke and position), and caption timing can be adjusted per line.

**Status:** Live.

### Effects and colour

- **Colour grading:** exposure, contrast, saturation, temperature, tint and vibrance. 5 colour looks: Warm Film, Cool Cinema, Golden Hour, Muted Film, Noir, each with a strength setting.
- **Texture effects:** Film overlay, VHS overlay, Digital glitch, plus blur, zoom blur, invert and rounded corners.
- **Timed effects:** punch, quick zoom in, quick zoom out, and solid colour flashes.
- **Transitions:** crossfades and visual fades.
- **Background removal:** cut out a person, or keep a named object.

**Status:** Live. Background removal is Paused (Ultra).

### Audio

- **Sound effects:** a library of 70 CC0 sounds in 8 categories (hits, clicks, pops, textures, whooshes, ambience, transitions, risers).
- **Generated sound effects:** 34 designs (whoosh, riser, sub-drop, impact, glitch, and more) rendered by Revline's own synth, with no outside provider.
- **Beat detection:** finds beats, downbeats, accents and possible drops, and can snap cuts to the beat.
- **Mixing:** fades, voice and music roles, music ducking under voice, volume up to 200%, and waveforms.

**Status:** Live.

---

## Import and export

- **Import:**
  - Large uploads in 32 MB parts with no 100 MB cap.
  - Sources up to 24 hours long.
  - YouTube links (videos, Shorts, embeds) and direct MP4 URLs.
- **Export:**
  - MP4 at 720p or 1080p, 24, 30 or 60 fps, and standard or high quality.
  - Up to 5 minutes per export.
  - Renders run on dedicated cloud machines with a queue, so several exports can wait their turn.
  - The export preview uses the first shot of the exported video.
  - 4K export is Paused (Ultra).
- **Sharing:** share a timeline with an optional chat preview, which others can copy into their own project.

---

## Plans

- **Revline Editor Pro:** $39/month with a 3-day trial. Includes MCP, 1080p with no watermark, unlimited projects and 50 GB storage.
- **Revline Ultra:** $199/month, currently paused. Would add frontier models, Fast mode, model choice, 4K export, parallel exports and 500 GB storage.
