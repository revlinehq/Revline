# Revline

An AI video editor built with Next.js, shadcn/ui, Clerk, Convex, Cloudflare R2, and HyperFrames. Describe an edit in chat, watch the preview update, and export your video. The landing uses Space Grotesk; the workspace uses Inter with light and dark themes.

Planned product direction: [Future features](future-features.md), including motion design from scratch.

## Run locally

```bash
npm install
npm run dev -- --port 3001
# In a separate terminal, for durable processing and exports:
npm run worker
```

Open http://localhost:3001. `/chat` starts a new project; creating or reopening a project opens `/editor/[projectId]` with its conversation, preview, and editable timeline together. Existing `/chat/[projectId]` links redirect to the matching editor. The retired `/editor/demo` and `/chat/demo` routes return 404; editor smoke checks use `/dev/editor`, which is available only in local development. `/chats` shows your saved conversations, `/profile` is the account page, and `/projects` redirects to `/chat`. Saved projects and their data require Clerk sign-in and ownership checks.

Internal routes share an authenticated `(dashboard)` layout. `/sign-in` and `/sign-up` use one custom Google or email-code flow, including new accounts; verified Clerk identities sync to private Convex profiles. A temporary, tab-scoped IndexedDB draft preserves attached footage through authentication and clears each file after its successful import. An incomplete initial import keeps the request saved instead of starting the AI edit.

The current development project uses `.env.local`. For a fresh installation, use `.env.example` as the configuration reference. Configure Clerk's Convex JWT template and matching Convex auth issuer, then run `npx convex dev` against your development project. Never commit private keys.

```bash
npm run typecheck
npm test
npm run build
```

To build without replacing a running development server's output:

```bash
REVLINE_DIST_DIR=.next-build npm run build
REVLINE_DIST_DIR=.next-build npm run start -- --port 3002
```

## Editing

- Each project opens directly in the full editor, with resizable conversation, preview, and timeline panels, shared composers, and reusable navigation. Project revisions and chat messages are saved in Convex.
- Shared visual layers for video, images, and text with V labels, plus separate A audio layers; add, reorder, compact, collapse, and delete empty layers.
- Revline’s custom timeline provides clip and marquee selection, floating drag previews, multi-clip movement, trimming, its ruler, zoom, and scrolling. Shift-click adds clips to the selection; Ctrl/Cmd+A selects all. Delete and duplicate work on the selection, with application undo.
- Ctrl/Cmd+C copies selected clips, including linked audio; Ctrl/Cmd+V pastes at the playhead with fresh IDs. Right-click offers Copy and Paste here. The clipboard stays within the current project and preserves source trims, effects, and relative timing.
- Frame-snapped splits and playhead scrubbing, keyboard trimming, timeline zoom, nearby clip-edge snapping, and smooth playhead playback. Moving a selection snaps its clip starts and ends; dropping above or below a group can create a layer.
- On-canvas visual move/resize plus source cropping, fit/fill, position, scale, rotation, opacity, and reset. Canvas presets: 9:16, 4:5, 1:1, 4:3, and 16:9.
- Streaming replies reuse ViralShark’s incremental text fade. Reading earlier messages preserves your scroll position; Stop cancels the current run without discarding saved edits.
- Structured Claude tools edit saved timeline state and update the preview after each completed edit. Selected clips and the playhead are supplied as context. `inspectTimeline` reads the latest saved revision, visual gaps, same-layer overlaps, and missing source references.
- Word-timed subtitle generation, beat-aligned cuts, strongest-scene selection, and face following use saved analysis results.
- Effects are independent amber clips on V tracks: fade, punch zoom, impact shake, flash, pop, and animated cinematic bars. New effects start at the playhead, affect only lower visual tracks, and can be moved, stretched, split, or deleted independently. `EFFECT_CATALOG` defines preset labels, default durations, and keyframes. The preview and MP4 renderer share the same composition.
- Visual overlays support Normal, Screen, Multiply, Overlay, and Add light blending. Orange beat markers use M to add, drag to move, click to seek, and right-click to rename or delete; they also work as snap targets.
- MP4 export runs from a frozen timeline snapshot in a background Node worker; progress and completion persist in Convex.

Arranging and saving clips has no fixed duration or clip-count cap. Timelines retain a 150 KB serialized payload limit, with at most 24 visual layers and 12 audio layers. MP4 export currently supports final edits up to five minutes; the export dialog reports this before a render is queued. Uploads and exported MP4s stream into a private Cloudflare R2 bucket in 32 MB parts. There is no 100 MB upload cap; transport limits, available render-server disk, and processing time still apply. Convex stores ownership and project metadata. Playback and seeking use signed URLs from the media Worker.

## Error monitoring

Clerk signup/deletion and Stripe billing alerts are connected to production Discord notifications. Sentry and PostHog remain scaffolded and inactive until configured. See [observability setup](docs/observability.md) for the remaining account settings, endpoint URLs, and verification steps. Browser analytics currently captures page views only, with session replay and text autocapture disabled.

`node scripts/convex-error-monitor.mjs --start` starts read-only Convex log streams for development and production. `--summary` returns new failures plus capture health; `--ack <event-ids...>` acknowledges only reviewed events. The watcher removes validator payloads, signed URLs, and credential patterns before saving bounded, deduplicated summaries in `~/.local/state/revline-monitor` (outside the repository). It never stores raw console payloads or credentials.

The local watcher reconnects interrupted streams. A Codex heartbeat can check its summary every five minutes, triage new failures, and restart it after a computer restart with `--start`. Check `healthy` and `warnings`, not only `running`: the capture parent can remain alive while one deployment stream needs attention. Run these commands with host process visibility; sandbox PID isolation can otherwise report a running host process as absent. Monitoring pauses while this computer is off; Convex log retention limits what can be recovered afterward. This is separate from Sentry's hosted exception integration and is not an instantaneous webhook into Codex.

## Provider configuration

Claude editing requires `ANTHROPIC_API_KEY` in the Convex deployment. Gemini native video understanding and word-timed transcription require the worker-only `GOOGLE_GENERATIVE_AI_API_KEY`. Video inputs explicitly use `processing: "agentic"`; Gemini chooses its own video/audio inspection passes. Revline requests `gemini-3.7-flash`, which Google currently routes to `gemini-3.8-flash`. The overview and focused video questions return validated source timestamps; model timestamps are evidence for editing tools, not a guarantee of exact decoded impact frames. No local scene detector or manually extracted JPEG pass runs with the overview. TwelveLabs is removed. Legacy queued shot/frame tasks remain compatible with their saved schema. Model settings are listed in `.env.example`.

Music tracking uses the pinned CPU [Beat This](https://github.com/CPJKU/beat_this) model for musical beats and bar starts. Separate measured spectral changes identify prominent hits, and sustained energy rises produce possible-drop candidates. These are distinct event types; candidates require listening and do not prove a musical drop. Legacy onset-only caches are refreshed before marking or aligning cuts. The AI asks which audio to use when the target is ambiguous.

New video uploads queue an overview in the background without waiting to edit. Saved overviews can provide up to three source-grounded suggestion buttons; clicking one submits an ordinary request with the matching clip context. Focused requests use `inspectVideo` to send the actual question and source window to Gemini's native agentic video processing. Answers, including zero matches and uncertainty, are saved per request without replacing the general overview or editing the timeline. The separate frame/shot tools are no longer exposed to the editing assistant.

Beat detection decodes audio and measures onset peaks in the background worker. Face following uses the bundled MediaPipe detector in worker-side Chromium; it is not arbitrary-object tracking. The public demo can still run local tracking in its browser. Analysis results persist on the owned asset and notify the active AI run without a browser relay.

Media preparation, AI-requested analysis, and exports use `@convex-dev/workflow`. Convex queues owned tasks, retries transient failures up to three times, and replaces expired worker leases. Scoped attempt tokens protect result writes and R2 uploads; completed audio/MP4 uploads are reused on retry. The worker subscribes to queued work instead of polling while idle. Closing the editor leaves queued/running work intact, and reopening reads its saved state. An AI reply can still reach its existing action timeout while a long analysis continues; a subsequent edit can use the saved results.

`npm run worker` starts the development daemon on this computer. Production processing runs in the [Cloudflare media processor](infra/media-worker/README.md), which supplies FFmpeg, the pinned CPU beat-tracking runtime/model, Chromium, and its production environment. Convex Workflow coordinates the saved queue and leases; the container runs the media tools. Uploading a local file still needs the browser until its R2 upload has finished.

## Production deployment

The hosted app is https://tryrevline.com, in Vercel project `techson1cs-projects/revline-editor`; https://editor.tryrevline.com remains an alias. Cloudflare continues to manage DNS and email records. The connected GitHub repository is `zuraHQ/revline-editor`; pushes to `main` trigger production builds. Production uses Clerk's live instance for `tryrevline.com` and Convex `different-gnu-398`, with `APP_ORIGIN=https://tryrevline.com`. Localhost continues to use the development instance and Convex `majestic-alpaca-541` through `.env.local`.

Vercel holds the production Clerk secret and public Convex/Clerk settings. The Anthropic key and media-worker credentials belong in production Convex. Gemini keys belong only in the processing worker's environment. Environment files, generated build output, and private fixtures are excluded from Git and Vercel uploads.

The production R2 gateway uses `cloudflare/media/wrangler.production.jsonc`, allows both hosted origins, and has its own signing secret. Deploy it with `npx wrangler deploy --config cloudflare/media/wrangler.production.jsonc`. Deploy Convex changes to the announced production target with `npx convex deploy --yes --typecheck enable`; verify the selected deployment before running this command.

Production media processing is hosted by `revline-media-processor-production` on Cloudflare, connected to Convex `different-gnu-398`; it runs independently of this computer. The 2026-10-17 inspection retry rollout and production readiness checks are recorded in the [processor deployment notes](infra/media-worker/README.md). `npm run worker:production` remains an optional manual daemon using private `.env.production.local` settings for coordinated maintenance. Queued jobs remain saved in Convex until a worker can claim them.

Video-link imports are available on the new-edit page and in the editor’s Sources panel. Public YouTube links and direct HTTPS MP4 downloads are queued through the same workflow, saved privately to R2, and appended to the current timeline without replacing concurrent edits. Limits: five-minute sources and 500 MB. Downloads check public DNS addresses, pin the connection to the checked IP, revalidate redirects, and reject webpages. Imported streams are remuxed or converted to H.264/AAC for browser playback; audio preparation runs afterward. A full timeline leaves the imported source in Sources and reports the limit.

YouTube worker setup (FFmpeg and Node 22+ are also required):

```bash
uv venv .data/video-import
uv pip sync --python .data/video-import/bin/python scripts/video-import-requirements.txt
```

The worker uses `.data/video-import/bin/yt-dlp`; `YT_DLP_PATH` can point to another installed executable. The pinned requirements include yt-dlp’s JavaScript challenge support. YouTube can restrict downloads or require sign-in; no browser cookies, account credentials, or access-control bypasses are used. Restricted videos return an import error and can be added as local files instead.

The public demo explicitly shows a sample conversation. Its local editing, preview, selection, and transform controls work without model credentials. No live Claude or Gemini inference is claimed without configuring and testing those providers.

Stripe billing is scaffolded and gated by `BILLING_ENABLED=false`. The single Revline Editor Pro plan is USD $39/month, with a 3-day free trial on the first subscription. Its live catalog product and price remain inactive; no checkout, webhook processing, or charges are enabled. Trial checkout collects a payment method and renews monthly unless canceled. Returning subscribers do not receive another trial. Activation requires the matching price, server secret, signed lifecycle webhook, and an intentional billing enablement. Tax collection is not configured.

## Architecture

The existing Convex API can serve web and mobile clients using the same Clerk identities and Cloudflare media services. See [connecting a mobile app](docs/mobile-backend.md) for the current function map, native upload flow, authentication, and remaining platform-specific work.

HyperFrames provides HTML/GSAP playback and video rendering. Revline owns the project/timeline model, editor controls, source geometry, AI tools, media analysis, authentication, persistence, and billing integration.

Zustand holds per-project interaction state and local history. Convex persists owned assets, versioned timelines, conversations, analysis requests, and export jobs. Editing tools use validated structured arguments and revision checks. Consecutive AI edits share undo history; manual edits remain protected from stale writes.

Revline’s custom timeline uses DOM clips, pointer gestures, and the same Zustand project model as the editing tools. Floating drag previews and frame-aligned destinations are transient; releasing a gesture creates one undoable edit. HyperFrames remains the sole playback clock for the preview, playhead, and time readouts.

Shared editor controls live in `components/editor`: `effect-slider.tsx` owns slider appearance and gesture behavior, and `fade-controls.tsx` renders the audio/footage fade rows. Keep appearance changes in those controls and their own stylesheets. Callers supply values and callbacks rather than copying markup or styles.

Editing rules live in `lib/editor` and are imported by both the frontend and Convex tools. `visual-effects.ts` owns effect defaults and validated merges; `visual-effect-actions.ts` owns group reset/removal. `audioSettingsPatch` and `visualFadePatch` own settings merges, validation and fade-clock resets. Manual controls, drag/drop and agent operations should call these functions instead of maintaining separate default maps or edit rules. New controls should reuse the shared control and the corresponding validated operation.

OpenCut Classic preview and editing patterns are adapted with MIT attribution retained in `third-party/`. OpenChatCut was reviewed as an architectural reference; its AGPL source is not included.

## Verification

### Development SAM mask lab

Run the normal development server and open `/dev/sam`, or choose **SAM 3 (dev)** in the effects library. Add `META_MODEL_API_KEY` to `.env.local`; the key stays in Next's server runtime. This experiment calls Meta's `sam-3.1` API, streams masks through the official parser, and previews them with Meta's frame-indexed video player. FFprobe must be installed. Use an MP4/MOV up to 10 seconds, 600 frames, 1080p and 20 MB; the server checks actual media metadata before a provider call.

Both the page and API are disabled outside `NODE_ENV=development`. Files and masks remain temporary; the lab doesn't save timeline edits or implement masked exports. No Meta call runs before you press **Find masks**. A real key with SAM access is required to validate tracking quality. `node scripts/sam-mask-lab-smoke.mjs` exercises generated video and synthetic provider events without calling Meta.

The Claude editing model picker is separate: `MODEL_SWITCHER_ENABLED=true` on Convex enables manual Haiku/Sonnet/Opus choices in either development or production. Each edit run pins its provider and model at submission; absent a choice, existing model environment defaults still apply.

Unit tests cover timeline operations, selection/movement geometry, source crop/transform math, media analysis adapters, authorization, revision conflicts, and inactive billing. Browser checks live in `scripts/`: editor, timeline interactions, transform/crop, and face following. Render checks decode real exported MP4 frames and audio.

`scripts/live-integration.ts` exercises a local application against development Clerk and Convex, creates temporary fixtures, and removes them afterward. It refuses non-local origins, production deployments, and live Clerk keys. Start the media worker first. Set `REVLINE_SPEECH_FIXTURE` to a local public-domain video to include real transcription, understanding, extracted audio and waveform checks. `scripts/worker-tracking-smoke.ts` verifies background face detection with an official MediaPipe fixture.

Music worker setup (Python 3.13 and FFmpeg):

```sh
uv venv --python 3.13 .data/beat-tracking
uv pip sync --python .data/beat-tracking/bin/python --index-strategy unsafe-best-match scripts/beat-tracking-requirements.txt
node scripts/install-beat-model.mjs
node --import tsx scripts/music-beats-smoke.ts
```

The installation script verifies the pinned model checksum; processing jobs do not download model weights. `BEAT_TRACK_PYTHON` and `BEAT_TRACK_MODEL_PATH` override the local paths on a hosted worker. Inference uses two CPU threads and no CUDA runtime. The annotated music smoke checks separate pulse/hit timestamps, a known energy rise, trimmed/speed-adjusted timeline mapping, and silence; it is not a general music-accuracy benchmark.

`node --env-file=.env.local --import tsx scripts/agentic-video-smoke.ts` sends a generated 4-second red/blue video to the actual Gemini API, verifies native agentic processing steps and timestamped scene evidence, and deletes the uploaded fixture without modifying a project.

GitHub Actions deploys production from `main` (`.github/workflows/ci.yml`). After checks pass it deploys Convex, then the frontend (`npm run build:cloudflare`, `npm run deploy:frontend:ci`) and the media processor release independently, so site changes never wait for a processor image. The processor releases (`npm run deploy:production -- --processor-only`, with cached Docker layers and the pinned beat model mirrored as the `beat-model-final0` release asset) only when `scripts/processor-changes.mjs` finds a difference since the last released processor commit in a file its entry points import or a runtime file it reads. Each service releases one run at a time. Production credentials live in the repository's `production` environment secrets (`CONVEX_DEPLOY_KEY`, `CLOUDFLARE_API_TOKEN`, `RENDER_WORKER_SECRET`); Clerk secrets remain on the Worker. Cloudflare Workers Builds is disabled so the frontend never deploys ahead of its backend. Production serves `tryrevline.com` and `editor.tryrevline.com`; the temporary preview domain is retired.
