# Footage preparation and activity states

Pen canvas: `41d329d5-846b-440f-b3f0-063d72b58fb3/pencil-new.pen`.

- `Tg4zA`: conversation switch loading screen. Keep the conversation visible; replace the preview, sources, and timeline with the saved footage thumbnail and a compact preparation status until playback is ready.
- `HrfFD`: loading failure with an explicit retry. Do not leave the loading animation running after failure.
- `StWnu`: processing-state board showing queued, analyzing, transcribing, beat detection, tracking, editing, rendering, upload, complete, retry, failure, stopped, and a question.

The animated sweep uses `../pen/readiness-sweep.glsl` and Pen's time uniform. It indicates activity, not a fabricated percentage. Percentages belong only to tasks with measured progress.

These are Pen designs. The application readiness gate still needs to wait for the first decoded picture and audio readiness, cancel stale preparation when switching conversations, and use a cached thumbnail without starting another decoder merely for the loading screen.
