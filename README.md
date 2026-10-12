# Revline

An AI video editor built with Next.js, shadcn/ui, Clerk, Convex, Cloudflare R2, and HyperFrames. Describe an edit in chat, watch the preview update, and export your video. The landing uses Space Grotesk; the workspace uses Inter with light and dark themes.

## Run locally

```bash
npm install
npm run dev -- --port 3001
# In a separate terminal, for durable processing and exports:
npm run worker
```

Open http://localhost:3001. `/chat` starts a new project; creating or reopening a project opens `/editor/[projectId]` with its conversation, preview, and editable timeline together. `/editor/demo` opens the public sample editor. Existing `/chat/[projectId]` and `/chat/demo` links redirect to the matching editor. `/chats` shows your saved conversations, `/profile` is the account page, and `/projects` redirects to `/chat`. Saved projects and their data require Clerk sign-in and ownership checks.

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
- MP4 export runs from a frozen timeline snapshot in a background Node worker; progress and completion persist in Convex.

The editor currently limits each project to 200 clips and five minutes, with at most 24 visual layers and 12 audio layers. Uploads and exported MP4s stream into a private Cloudflare R2 bucket in 32 MB parts. There is no 100 MB upload cap; transport limits, available render-server disk, and processing time still apply. Convex stores ownership and project metadata. Playback and seeking use signed URLs from the media Worker.

## Provider configuration

Claude editing requires `ANTHROPIC_API_KEY` in the Convex deployment. The optional Convex AI Gateway path remains disabled by default. Gemini word-timed transcription requires `GOOGLE_GENERATIVE_AI_API_KEY` in the media-worker environment. TwelveLabs Pegasus scene descriptions require the worker-only `TWELVELABS_API_KEY`. Video understanding also runs PySceneDetect against the original source frames and saves its measured shot boundaries separately from approximate semantic scene timestamps. Claude can request local-only shot detection with `analyzeMedia` mode `shots`. Strongest-moment selection snaps scene edges to saved shot boundaries. Model settings are listed in `.env.example`.

Beat detection decodes audio and measures onset peaks in the background worker. Face following uses the bundled MediaPipe detector in worker-side Chromium; it is not arbitrary-object tracking. The public demo can still run local tracking in its browser. Analysis results persist on the owned asset and notify the active AI run without a browser relay.

Media preparation, AI-requested analysis, and exports use `@convex-dev/workflow`. Convex queues owned tasks, retries transient failures up to three times, and replaces expired worker leases. Scoped attempt tokens protect result writes and R2 uploads; completed audio/MP4 uploads are reused on retry. The worker subscribes to queued work instead of polling while idle. Closing the editor leaves queued/running work intact, and reopening reads its saved state. An AI reply can still reach its existing action timeout while a long analysis continues; a subsequent edit can use the saved results.

`npm run worker` starts the development daemon on this computer. Production requires the same daemon on an always-running Node host with FFmpeg, Python/PySceneDetect, Chromium, and the configured environment. Convex Workflow does not supply those executables or host that process. The worker connects outbound to Convex and private R2 media; it needs no inbound public endpoint. Uploading a local file still needs the browser until its R2 upload has finished.

## Production deployment

The hosted app is https://tryrevline.com, in Vercel project `techson1cs-projects/revline-editor`; https://editor.tryrevline.com remains an alias. Cloudflare continues to manage DNS and email records. The connected GitHub repository is `zuraHQ/revline-editor`; pushes to `codex/mvp` trigger production builds. Production uses Clerk's live instance for `tryrevline.com` and Convex `different-gnu-398`, with `APP_ORIGIN=https://tryrevline.com`. Localhost continues to use the development instance and Convex `majestic-alpaca-541` through `.env.local`.

Vercel holds the production Clerk secret and public Convex/Clerk settings. The Anthropic key and media-worker credentials belong in production Convex. Gemini and TwelveLabs keys belong only in the processing worker's environment. Environment files, generated build output, and private fixtures are excluded from Git and Vercel uploads.

The production R2 gateway uses `cloudflare/media/wrangler.production.jsonc`, allows both hosted origins, and has its own signing secret. Deploy it with `npx wrangler deploy --config cloudflare/media/wrangler.production.jsonc`. Deploy Convex changes to the announced production target with `npx convex deploy --yes --typecheck enable`; verify the selected deployment before running this command.

`npm run worker:production` starts the production processing daemon with the private `.env.production.local` settings. It currently runs on this computer; an always-running worker host is still required to process media and exports while this computer is off. Queued jobs remain saved in Convex until a worker can claim them.

The public demo explicitly shows a sample conversation. Its local editing, preview, selection, and transform controls work without model credentials. No live Claude, Gemini, or TwelveLabs inference is claimed without configuring and testing those providers.

Stripe billing is scaffolded and gated by `BILLING_ENABLED=false`. The single Revline Editor Pro plan is USD $39/month, with a 3-day free trial on the first subscription. Its live catalog product and price remain inactive; no checkout, webhook processing, or charges are enabled. Trial checkout collects a payment method and renews monthly unless canceled. Returning subscribers do not receive another trial. Activation requires the matching price, server secret, signed lifecycle webhook, and an intentional billing enablement. Tax collection is not configured.

## Architecture

HyperFrames provides HTML/GSAP playback and video rendering. Revline owns the project/timeline model, editor controls, source geometry, AI tools, media analysis, authentication, persistence, and billing integration.

Zustand holds per-project interaction state and local history. Convex persists owned assets, versioned timelines, conversations, analysis requests, and export jobs. Editing tools use validated structured arguments and revision checks. Consecutive AI edits share undo history; manual edits remain protected from stale writes.

Revline’s custom timeline uses DOM clips, pointer gestures, and the same Zustand project model as the editing tools. Floating drag previews and frame-aligned destinations are transient; releasing a gesture creates one undoable edit. HyperFrames remains the sole playback clock for the preview, playhead, and time readouts.

OpenCut Classic preview and editing patterns are adapted with MIT attribution retained in `third-party/`. OpenChatCut was reviewed as an architectural reference; its AGPL source is not included.

## Verification

Unit tests cover timeline operations, selection/movement geometry, source crop/transform math, media analysis adapters, authorization, revision conflicts, and inactive billing. Browser checks live in `scripts/`: editor, timeline interactions, transform/crop, and face following. Render checks decode real exported MP4 frames and audio.

`scripts/live-integration.ts` exercises a local application against development Clerk and Convex, creates temporary fixtures, and removes them afterward. It refuses non-local origins, production deployments, and live Clerk keys. Start the media worker first. Set `REVLINE_SPEECH_FIXTURE` to a local public-domain video to include real transcription, understanding, extracted audio and waveform checks. `scripts/worker-tracking-smoke.ts` verifies background face detection with an official MediaPipe fixture.

PySceneDetect worker setup (Python 3.10+):

```sh
uv venv .data/scene-detection
uv pip sync --python .data/scene-detection/bin/python scripts/scene-detection-requirements.txt
```

The pinned dependencies must be installed on the media-worker host. `SCENE_DETECT_PYTHON` can override the interpreter path. Detection uses AdaptiveDetector and checks every source frame; it identifies existing hard cuts, while dissolves, flashes, and variable-rate sources may require review. It does not split the timeline until Claude applies editing tools.

`scripts/compare-video-understanding.ts <local-video> [output.json]` compares TwelveLabs and the previous Gemini visual adapter using the same proxy, prompt, and validation. Gemini visual analysis is retained for this explicit comparison only. Revline does not silently switch providers.
