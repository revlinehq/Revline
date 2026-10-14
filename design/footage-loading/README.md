# Footage preparation and activity states

Pen canvas: `41d329d5-846b-440f-b3f0-063d72b58fb3/pencil-new.pen`.

- `Tg4zA`: conversation switch loading screen. Hide the conversation, preview, sources, and timeline; center the saved footage thumbnail and compact preparation status until playback is ready.
- `HrfFD`: loading failure with an explicit retry. Do not leave the loading animation running after failure.
- `StWnu`: processing-state board showing queued, analyzing, transcribing, beat detection, tracking, editing, rendering, upload, complete, retry, failure, stopped, and a question.

The animated sweep uses `../pen/readiness-sweep.glsl` and Pen's time uniform. It indicates activity, not a fabricated percentage. Percentages belong only to tasks with measured progress.

Implemented in the editor: one preparation screen spans project/media fetching and first decoded picture/audio readiness. Switching chats cancels stale preparation. A real 352px JPEG is captured from the existing local upload decoder and stored with the source; older sources reuse their preview decoder to cache a frame. The loading screen does not create another decoder.
