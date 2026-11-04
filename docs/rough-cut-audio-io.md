# Rough-cut audio I/O audit

Source project `j9781fz6977c9dmy1nmf7s6kn98hjsrn` was inspected read-only after the user stopped Terra. No prompt, resume, cancellation, timeline edit or model/provider run was submitted. Source:184.806044s,652,874,714bytes; extracted AAC:5,950,994bytes.

## Persisted evidence

PC log `/tmp/revline-dev-3001.log` records extract task `k173amgh69at0x78zs718jbvfn8hj30n`:629.0s in Extracting audio,0.7s waveform,19.3s upload (overlapping waveform),648.3s total. The extract phase includes remote FFmpeg I/O and must not be called CPU time. Transcription `k17detrt1mp3qvf7n18xms8s318hjqcn` started05:51:25UTC while extraction was active and was later cancelled at30% progress. Its persisted view has no stage activity; that does not establish how much of the attempt Deepgram spent processing. At claim time no prepared audio was linked, so the old work snapshot selected the original video. Preview `k17e8cgnz1bxd6z4v14cbbpjas8hkpq3` failed3attempts for temporary disk capacity.

## Changes

Transcription waits while the same asset has an active extraction task, then uses its verified prepared-audio asset. Failure/cancellation releases the dependency instead of permanently blocking the queue. Normal and legacy claim selection both apply this gate. Audio-only tasks stage one local immutable input using the existing validated parallel range downloader; subsequent demux, MP3 encoding and quiet/cleanup reads use that local file. Render callers retain the existing3x-source disk policy. Audio work instead budgets the source, conservative audio-output allowance and256MiB headroom. Disk failures include required/source/headroom/free MiB and are non-retryable until capacity changes.

Speech-provider upload, response-body reading and all retries share one duration-scaled90–600s deadline. The184.8s source gets92.404s. Expiry is terminal for automatic task retries; explicit retry remains available. A separate claim-to-finish preparation/transcription budget scales from180–900s (184.807s for this source), covering source transfer and local measurements as well. Existing Stop cancellation wins. Stage labels use measured progress checkpoints and existing activity values, preserving the wire schema; they do not manufacture time-based progress or imply a transcript was saved before completion.

## Direct PC verification

The actual source's15s remote AAC-copy sample read53,158,274bytes to write484,389bytes and took24.389s with a larger input buffer. The unmodified sample did not finish within25s. Buffer/discard variants did not establish a reliable fix and no global FFmpeg flag change was retained. A full-source parallel download was deliberately bounded at150s, did not complete and cleaned up only its own partial file. Therefore no faster cold-source extraction is claimed; bulk bandwidth remains a limit.

The same source's actual prepared AAC downloaded in5.489s, converted to full-duration739,908byte speech MP3 in0.729s, and produced measured audio activity in0.332s (6.550s combined, excluding Deepgram and transcript-driven cleanup). Audio activity duration was184.789s. This proves the prepared-audio path, not an end-to-end rough-cut benchmark or a like-for-like cold extraction speedup. No ASR request was made. A pre-aborted real transcription call stopped before provider access.

The default disk guard rejected the623MiB source with1868MiB required versus1696MiB free and `retryable:false`, before transferring bytes. No existing cache or user data was deleted; the650MB original was never retained. No backend deployment or live queue rehearsal was performed for this draft. Typecheck/build and UI screenshot availability are recorded in the delivery handoff; PC browser/AppArmor limitations remain.
