# Recording the /clip prototype

Open `/prototype` on a development server and send `/clip` followed by any nonempty link or text. Every input replays the prepared TenZ source; it never imports that input. The dashboard, composer, chat, preview, timeline and tabs use the product components. The sequence is local React state, with no project saves, model requests, or queued media work. Export is unavailable.

- **Alt+Shift+R** resets to the new-project dashboard, including during a run.
- **Alt+Shift+F** toggles real-feel pacing and 5× faster pacing, including during a run. Speed is retained between resets for repeated takes.
- Click a completed clip tab to play its prepared vertical segment. Source keeps the visible cut boundaries.

The route is unlinked and noindex. Production returns 404 unless `REVLINE_CLIP_PROTOTYPE=true` is set on the frontend server. Media is deliberately excluded from git, so enabling the route alone does not install its footage.

The prepared files live on the recording PC under `public/prototype/`: `tenz-source.mp4`, `source.jpg`, and one `clip-N.mp4` / `clip-N.jpg` pair per pick. `components/prototype/clip-picks.json` stores source metadata, real analysis provenance, timings and measured facecam rectangles. Once the source is in place, `node scripts/prepare-clip-prototype.mjs` recreates the source segments with ffmpeg. The editor's real `applyTwoRowLayout` helper frames two synchronized video layers above one audio track. This preparation is an offline operator command; the browser never invokes it.

For a new recording machine, download the exact `sourceUrl` in the picks file with an up-to-date yt-dlp, choosing 720p and merging to `public/prototype/tenz-source.mp4`, then run the preparation command. Do not commit the media. This route is a scripted demonstration, and its playback timing is unrelated to the actual time spent analyzing the source.

The preparation called the real `findHighlights` implementation from commit `7aa2a0c`. Its 180,091 ms run returned Gemini HTTP 402 (depleted provider credits), so the saved picks follow its real fallback: whole-source audio signals, a 2,368-word Deepgram transcript, and inspected native 1280×720 source frames. These are verified fallback picks, not a successful semantic Gemini ranking. The initial dev `/clip` attempt also hit an undeployed completion integration and frame reads requiring worker 39 while available runtimes were 37. No backend was redeployed for this prototype.
