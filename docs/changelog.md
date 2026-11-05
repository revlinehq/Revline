## 2026-11-05

- Worker hosting: Remove Fly controllers, deployment scripts and rendering branches; keep shared queue demand and capacity limits independent of the host. Why: production now runs on Railway.

- Repository: Remove unused design source and preview images and ignore local design drafts. Why: the user requested excluding design working files from the public source.
- Worker hosting: Verify standard and Ultra jobs before promoting single-worker Railway exports; require remote chunk proof only when enabled. Why: Hobby repository builds must not depend on private registry support.

- Worker hosting: Refresh cached Railway deployments after dashboard resource changes and fit capture concurrency to CPU allocation. Why: reused deployment snapshots retained the old CPU limit.

- Worker hosting: Size Railway render threads from its allocation instead of applying Fly’s four-thread ceiling. Why: the real 4K staging export rejected eight threads.

## 2026-11-04

- Worker hosting: Preserve dashboard CPU and memory limits for permanent Railway services and size worker threads from actual CPU allocation. Why: manual resource changes must not block deployment.

- Railway builds: Install the checksum-pinned beat model inside Docker instead of copying a generated model directory. Why: repository builds must not depend on a local prepared cache.

- Worker hosting: Name Railway configuration mutations and preserve existing repository links. Why: Railway rejected the anonymous update during real staging.

- Worker hosting: Permit exact-PR isolated staging queue validation, scoped-key CLI targeting, repository runtime checks and bounded chunk concurrency. Why: staging must prove real jobs before production promotion.

- Worker hosting: Decode Railway structured runtime logs and reserve capacity while builds are pending. Why: real staging passed its limits but the controller missed parsed log attributes.

- Worker hosting: Add persistent isolated Railway staging, readable service names/icons and live-job promotion checks. Why: the user requires staging success before production and clear dashboard roles.
- Composer: Add the compact home composer with centered upload/clip icons and a `/clip [ENTER YOUTUBE URL]` shortcut; keep the editor flat. Why: user approved the design and requested centered icon actions.
- Cloud storage: Upload media without creating a project, then create an edit from one or several saved files. Why: the user wants phone uploads ready for editing later on PC.
- Documentation: Shorten the README and remove internal feature and roadmap notes. Why: the user requested a minimal public repository overview.

## 2026-11-04

- Security: Add Apache 2.0 notices, contributor and vulnerability reporting guidance, local credential scanning and patched dependencies. Why: the user requested open-source publication readiness.

- MCP frame reads: Return a resumable handle while frames render and retain results until download succeeds. Why: Timeout retries queued duplicate work and could discard unread images.
- Source frames: Reject empty receipts and return saved handles after transient result downloads. Why: first-call download failures hid resumable work (#87).

- Reference comparison: Resume pending renders and pixel comparisons on the original frozen revision with scoped receipts. Why: #86 restarted cancelled work after MCP timeouts.

- Source frames: Resume saved readFrames jobs after a bounded wait with scoped check handles. Why: #87 lost long-running responses and queued duplicate reads.

- Media tools: Retry aborted analysis and MCP frame enqueue transactions. Why: #102 reported task-slot conflicts escaping to callers.
- Editor skills: Author prose in Markdown and bundle it for all runtimes; sharpen measured recreation guidance. Why: user requested reviewable skills without changing readSkill.
- Media processors: Require the public X import release before claiming new import jobs. Why: Older processors could accept a status link without its supported extractor.

- Brand lookup: Require canonical brand matches before selecting programming-pack logos by name. Why: the shorthand Apollo slug returned Apollo GraphQL for a company lookup (#101).
- Reel completion: Load saved speech analysis before checking retained captions. Why: fresh tool calls lost separately stored video transcripts (#93).
- MCP: Bound visual-guard waits and cancel abandoned guard renders before releasing edits. Why: Transport expiry could leave scoped patches holding the edit lock.
- Scene capture: Decode bound video before the final Three draw and invalidate older captures. Why: #100 and #120 legacy playback captured black VideoTexture frames.
- Video import: Route public X status links through the supported downloader. Why: #114 treated supported video posts as direct MP4 files.

- Scene video: Overlay decoded still frames on video boxes and wait for the first decoded frame at zero. Why: original #100 captures omitted bound mascot imagery.
- Assistant models: Unlock every configured in-app model for paid subscriptions, including Sonnet and Opus, while trials stay on Terra Low. Why: the user wants model choice after trial conversion without an Ultra-only Claude restriction.

- Agent context: Reference repeated identical source transcripts within each user turn while preserving discovery metadata. Why: Repeated fallback discovery duplicated full speech evidence.
- Reference analysis: Preserve small traced interiors and label motion sampling, context and unverified background ownership. Why: Original footage reproduced #105 and #107.

- Frame reads: Round whole-source motion-scan timeouts to integer milliseconds. Why: Fractional media durations must produce valid Node process deadlines.
- MCP: Bound analysis waits while durable jobs continue saving results. Why: Healthy worker heartbeats could keep edit locks held after the caller lost its response.
- Film editing: Refuse trims beyond a film’s declared source length. Why: Split scene windows need valid coverage and one stable animation clock.
- Frame inspection: Add explicit one-frame 1080p composition reads with pixel dimensions and bounded encoding. Why: Layout checks need full composition pixels without inflating routine previews.

# Changelog

Newest first. Each merged pull request adds its lines here, grouped by system.

## 2026-11-04
- Worker hosting: Build permanent Railway services from explicit repository commits while chunks retain matching immutable artifacts. Why: the user requested repository integration without competing autodeploys or per-chunk builds.
- Worker hosting: Verify Railway placement from its environment configuration. Why: the authenticated service API returns a null legacy region even when placement is explicitly configured.
- Worker hosting: Shorten Railway temporary service names and validate nested container limits. Why: authenticated API inspection rejected long names and revealed the actual limit response.
- Worker hosting: Allow exact published PR image builds and Railway-only temporary preflights without Convex access. Why: the authorized rollout must validate containers before merging backend changes.
- Worker hosting: Add staged Railway processors, exports and distributed chunks with bounded resources and explicit cutover/rollback. Why: the user requested moving only Fly container hosting while retaining the existing app, backend and storage.
- Media analysis: Pause fresh Gemini analysis and composition reviews per owner and configured key for 15 minutes after genuine billing rejections. Why: #111 repeated new runs downloaded and uploaded footage against an unfunded provider.
- Reference tracking: Register expanding panel silhouettes and fit independent box axes through the worker and saved-result validators while retaining rigid transforms. Why: #104 lost the card as its contents and proportions changed.
- Frame capture: Retain video preroll for sparse final-frame windows when source audio runs longer. Why: #117 lost the last video stream and retried valid end frames.
- MCP timelines: Bind scoped edits to their target tab and restore selection within each write. Why: issue #92 reported background edits switching the user’s visible timeline.
- Project copies: Remap film references and generated-image provenance to copied assets across saved tabs. Why: project-owned media bindings must follow the copy rather than retain source-project IDs.
- Media processing: Stop retrying wrapped disk exhaustion and import free-space refusals, including SQLite disk-full errors. Why: exhausted workers repeated permanent failures three times.
- Reel verification: Persist sparse checks through draft writes, reuse unchanged failures, keep boundary words, and stop disk-full retries. Why: the real Fast benchmark restored dense checks and lost caption coverage.
- Reel: Use data checks for Fast speech assembly, batch source grids for visual cleanup, sample caption/framing once, and choose J/L cuts selectively. Why: shared render gates repeated work at every speech and caption edge.
- Editor: Removed the explainer workflow and skills while retaining shared motion scenes and legacy records. Why: Narrower product scope and context keep footage workflows focused.
- Motion design: Carry visual anchors across scenes and choose restrained motion for each action. Why: the user's continuity guidance conflicted with blanket overshoot and anticipation rules in the agent skill.
- Assistant: Show Working between steps while preserving the elapsed timer and resume/stop statuses. Why: the user requested a shorter activity label.
- Incident delivery: Route agent reports to durable, deduplicated GitHub Issues with bounded leases and explicit backlog delivery. Why: the user needs saved reports surfaced without launching fix agents.
- Assistant models: Keep free/trial accounts on Terra Low with visible locked upgrades; unlock existing choices from verified paid terms. Why: model entitlement must be separate from editing access.
- Landing: Remove the short-form editing showcase section. Why: simplify the landing page by dropping the unwanted Reel showcase.
- Release validation: Declare shared Fly resource types, narrow optional machine settings and run all release typechecks in CI. Why: the agent-runner check blocked the approved cap release after ordinary CI passed.
- MCP: Resolve sessionless calls by an unambiguous explicit project and timeline. Why: transport session IDs are optional, so task context must remain addressable without borrowing another conversation.
- Fly workers: Cap each processor, export, chunk and preflight at 4 CPUs/8192 MB, match volume placement, and honor zero-capacity holds. Why: the user's per-worker architectural budget must stay consistent across runtime and preflight.
- Analysis tools: Preserve exact sound range endpoints and overlap sub-minimum continuation tails; return compact effect-plan acknowledgments. Why: rounded bounds produced invalid follow-ups and repeated plans inflated context.
- Analysis tools: Require exact brand names or aliases and accept small UI capture dimensions. Why: substring matches returned unrelated logos and valid composer captures were refused.
- Assistant workflows: Share basic edits, load supporting skills without replacing the deliverable, and retain source evidence across styles. Why: lane ownership coupled tools, task checks and conversation memory.
- Reel and captions: Clean one-take rough cuts at their natural duration and default new subtitles to minimal text without a background. Why: fixed duration, forced normalization and boxed subtitles distorted the intended edit.
- Agent context: Preserve verified normalization status when compacting timeline summaries. Why: a second projection falsely reported active audio masters and clips as inactive (#97).
- Deployment: Retry reset connections when reading Fly preflight status within its existing deadline. Why: a transient TLS reset aborted the latest main release after its image upload.
- Media preparation: Share prepared audio with transcription, stage audio inputs locally, bound speech-provider waits and report non-retryable disk shortages. Why: rough cuts reread large video sources and hid slow stages.
- Agent runner: Allow scoped skill capability loads and pixel-track reads. Why: runner authorization rejected tools used by editing workflows.
- Deployment: Package reference tracking and its shared frame reader in processor images. Why: the main release failed its image runtime check before deployment.
- Developer isolation: Add explicit faithful snapshots of saved tabs, hydrated analysis and media relationships. Why: metadata-only seeds cannot serve as cached-analysis development baselines.
- Assistant: Anchor elapsed time to the original user message, including legacy retry recovery. Why: creating a recovery turn must not restart the request clock.
- Clip planning: Return all quote and acceptance errors with exact word windows, current IDs and range limits. Why: the podcast benchmark repeated rejected plans after vague diagnostics and candidate replacement.
- Snapshot recovery: Recover same-lease cache reservations, retain completed clip checks across lease handoffs, and bound transport retries. Why: lost responses could make a worker wait on itself or repeat finished work.
- Clipping: Activate delivery when candidates are accepted and keep completion guidance on inline data checks. Why: the single real podcast benchmark exposed candidate-only accounting despite built tabs.
- Chat history: Return focus to a surviving nearby chat without scrolling after deletion. Why: deleting a row jumped the user back to the search field.

## 2026-11-03
- Clipping: Default all clips to inline data validation, original audio and bounded targeted video discovery; heavy QA is scoped and opt-in. Why: the user rejected automatic normalization and repeated full-batch checks.
- Clipping: Use saved transcripts and data checks for podcast/talk cuts, preserving source framing and audio. Why: the user requested spoken-content clips without mandatory visual processing.
- Agent context: Project numeric highlight helpers by source window and let non-Claude turns compact superseded results. Why: the full-podcast run repeatedly carried large source payloads.

- Clipping: Preserve speaker crops in extracted review windows and reuse passing checks without resending raw RMS tracks. Why: the full-podcast rehearsal exposed bad framing sheets and repeated work.
- Assistant: Measure elapsed work from the persisted user turn across phases, retries and reconnects. Why: the user saw the full-podcast timer repeatedly reset.
- MCP isolation: Forward initialized client identity and close upstream sessions on disconnect. Why: real PR58 verification exposed hidden identities and lingering presence.
- Clipping: Carry long transcripts in bounded RPC chunks. Why: the full Syntax run exceeded Convex’s 8,192-item argument-array limit.
- Clipping: Expose source frame reads and reuse current receipts for explicit clip checks. Why: real gaming verification found missing fallback access and redundant checks.
- Clipping: Let Gemini judge whole-source highlights and verify each accepted clip tab with data checks and one framing sheet. Why: the user wanted faster whole-source discovery and honest delivery where clips found equal tabs made.
- Verification: Run PR checks on GitHub-hosted Ubuntu. Why: Blacksmith jobs stayed queued without a runner.
- Editor: Make whole choice cards select their option and give each question unique radio IDs. Why: the user could only reliably select the radio button.
- Landing: Move short-form editing to the third showcase and use the purple-outline Start editing button. Why: the user requested the corrected order and button style.
- Landing: Added the short-form editing section with a real agent-edited talking-head Reel and a viewport-driven cut, caption and zoom illustration. Why: the user requested a short-form showcase after clipping.
- Snapshots: Align decoder seeks to composition precision and handle failed cache captures without stopping the worker. Why: PR verification exposed a rejected FFmpeg seek and worker crash.
- MCP identity: Distinguish Antigravity from Gemini using initialized client identity and Google’s official app mark. Why: the user requested accurate app badges for shared-token sessions.
- MCP presence: Show each active agent’s company on project cards and timeline tabs, using initialized client identity. Why: personal-token agents appeared as generic MCP and concurrent agents hid one another.
- MCP: Isolate conversations and task targets; list all lane-labeled tools with call-time checks. Why: parallel Codex agents shared task context and could not discover lane tools.
- Prototype: Add an isolated, replayable /clip recording flow using the real dashboard and editor. Why: the user needs repeatable marketing Reels without live AI runs.
- Reference motion: Track full-resolution elements and calibrated opacity, and fit complete GSAP timing/eases in Motion and Recreate. Why: the user-approved benchmark found missed motion and trimmed easing tails.
- Development: Give each agent worktree an expiring Convex backend, seeded footage and private Workers. Why: the user reported agents overwriting shared dev functions and schema.
- Editor: Read rendered frames without following redirects in Cloudflare Workers. Why: isolated verification exposed an unsupported fetch mode that stopped editor turns.
- Deployments: Keep runner Node connections on IPv4. Why: Fly preflight failed on the deployment host's missing IPv6 route.
- Deployments: Release changed production and development services in order on the PC after main merges, then restart the main dev server. Why: the user kept finding merged main changes undeployed.
- Editing agent: Integrate persisted motion evidence and timed off exits into recreate and bound-reference motion lane checks. Why: the lane registry merged while PR #51 awaited approval.
- Agent: Let the editing agent choose its lane before exposing tools, with manual choices, isolated skills and bounded finish checks. Why: the user requested agent reasoning instead of keyword routing and premature completion claims.
- Editing agent: Preserve R2 frame caching and media recovery alongside motion recreation gates when updating PR #51. Why: main advanced while the recreation changes waited for merge.
- Scenes: Temporarily retire Three.js authoring and guide the agent toward GSAP scenes. Why: the user has no current use case and the agent chose it unnecessarily.
- AI: Revline uses a single OpenAI key; the backup key that took over when the main account ran out of credit is removed. Why: the user replaced both with one funded key.
- Clipping and media: Check shared runtimes, retry transfers, keep healthy analysis and leases alive, persist Gemini fallback, clarify overlay audio links and show tool reasons. Why: mixed dev workers, timeouts and an outdated agent runner broke gaming clipping during storage interruptions and a provider outage.
- Landing and editor: Removed Inspo Motion: the landing section, the product-menu link, the /inspo-motion command on web and iOS, and the /sharingan page, which now redirects home. Why: the user retired it; recreation stays a dev-testing capability through the MCP tools.
- Reference reads: Cache exact frames and deterministic readings in private R2, with revision-scoped timeline renders. Why: agents repeatedly decoded the same moments and filled the media queue.
- Link imports: Correct the stale five-minute hint, cap retries at three attempts, and add cancellation and file-upload recovery with the last error. Why: agent testing found misleading limits and imports that retried forever.
- Editor: The timeline tab row scrolls sideways with a normal mouse wheel, and the open tab scrolls into view. Why: after /clip makes many tabs, the extra ones were unreachable without a trackpad.
- Footage: Keep one weighted loading percentage through upload, playback, analysis and editor opening, including retries and view changes. Why: the user reported progress restarting between stages.
- Composer: The plus button and model pickers sit closer together, with less padding around the model names. Why: the user found the spacing too wide.
- Editor: The dark editor uses the same neutral greys and #111 background as the new-project dashboard instead of blue-tinted ones. Why: the user noticed the two looked different.
- Dashboard: The new-project composer has a lighter, shorter drop shadow. Why: the user found it too heavy.
- Dashboard: The new-project composer send button is brand purple again instead of grey. Why: the user wanted the purple button back.

- Editing agent: Require measured reference motion before building, report revision-bound differences and timed off reasons, and queue recreation checks at the media cap. Why: recreated launch films lost their motion and stopped at refused checks.

- Editor: Typing /clip or /inspo-motion now stays as plain text in the composer instead of turning into a removable badge. Why: the user wanted just the text.

## 2026-11-02

- Audio tools: Restore development sound, narration and music matching, identify rejected tool mutations, and share pinned beat dependencies across dev worktrees. Why: Terra's launch film was blocked by editing failures on shared development.

- HTTP: Bound runner start requests and stream forwarded MCP bodies. Why: unauthenticated uploads could allocate large buffers before rejection.

- Scenes and media: Keep stored scene code and share cards out of subscribed rows, retain large-film undo, and isolate worker scheduling from heartbeats. Why: large scenes could hit document limits and queue reads still conflicted with progress updates.

- Security: Restrict remote downloads, pin published thumbnails, check all tabs before deleting media, and throttle paid retries and audio. Why: the audit found privacy, SSRF, data-loss and cost-control gaps.

- Database I/O: Separate numeric task progress, slim chat display rows and turn status, and keep run bookkeeping off timeline and prompt payloads. Why: large subscribed rows and repeated progress writes amplified database reads.

- Database I/O: Remove scene hydration from run bookkeeping, isolate catalog status and frame cleanup, and publish reference results to file storage. Why: one-user traffic consumed gigabytes of database bandwidth.

- Landing: Removed the “Recreated in Revline from a reel by @hc.prath” caption under the motion design film. Why: the user didn't want it.
- Editor: The aspect ratio menu is now a compact “Video format” list (YouTube, Reels·TikTok·Shorts, Square, Feed, Classic) with outline shapes, sizes and an inline safe-area toggle. Why: the user called the old picker terrible and approved Pen design eqEih.
- Editor: The aspect ratio switcher left the editor composer and is back on the preview; the dashboard composer keeps its format header. Why: the user said it made no sense above the editing chat.
- Editor: The empty preview is now a quiet dashed drop area with “Start with a clip or an idea”, one Add footage button and a drop hint, with no gradient. Why: the user picked Pen design W2tfzE.
- Editor: The X-high reasoning effort label now shimmers in a light moving rainbow, like Claude Code's ultrathink, in the composer and effort menu. Why: the user wanted the strongest effort to feel powerful.
- Agent assets: Keep asset-only image generation and short ideation that goes straight to building; remove board workflows and chat meta footers. Why: the user rejected the intermediate planning stages.

- Workspace: Add the reference’s tucked format header to new-project and editor composers; keep the chosen ratio through creation and import. Why: the user requested the Kino header design.
- Skills: Shorten 14 editing skills and replace vague guidance with checks while retaining motion tools and incident fixes. Why: the user requested specific, human instructions without duplicate rules.

- Skills: Add `npm run skills:rank`, which scores each editing skill on numbers, tool checks and examples and lists its vaguest lines. Why: the user wants skills ranked best to worst with reasons.

- Workspace: Match the approved home composer and compact project list with footage menus and stored posters. Why: the user requested the Pen design.
- Workspace: Slash commands (/clip, /inspo-motion) now work in the new-project composer, not only in the editor. Why: the user found them missing on the dashboard.

- Landing: Play the motion study inside the shared Revline editor illustration with scene-aligned clips, graphics, a music waveform and a synced playhead. Why: the user requested an editable-film showcase matching the clipping section.

- Editor: New-project composer sits at optical centre, slightly above the middle. Why: exact centre read as low.
- Editor: Apply the approved timeline clip design with persistent labels, current track colours, text previews and compact identities, without clip keyframes. Why: the user approved Pen mTG6i’s structure and requested the existing app colours.
- Skills: Add motion taste judgments, reference learning and a short rendered critique anchored in user memory. Why: Zura asked for original design judgment beyond replication.
- Editor: the new-project headline is now always “What are we making today?”. Why: the user picked it.
- Editor: removed the gradient behind the new-project page; it is plain dark now. Why: the user asked to remove it.
- Editor: the new-project composer is centred again, "Your projects" sits 20px below it, and the Pen mesh background is recreated in CSS with no image. Why: the user asked for a centred composer, a closer project list and no background image.
- Editor: the new-project page rotates its headline once you have footage, and "Your projects" now starts in view. Why: the user disliked the fixed headline and the list sat below the fold.
- Editor: the new-project gradient is now drawn in CSS with fine grain, so it stays sharp at any size and fades out instead of cutting off. Why: the image version looked low quality and was cropped.
- Editor: removed the “Take a quick tour” button and dialog from the new-project page. Why: the user didn't want it.
- Editor: the empty new-project headline is back to “From an idea to a first cut.”; the personal headline shows only once footage exists. Why: the user wanted the original empty-state line.
- Workspace: Greet users by name and hide starter prompts once footage is attached or saved, or timeline clips exist. Why: Zura wants a useful invitation for each editing state.
- Assets: Retain the optional generated-image provenance validator already used in development. Why: deploy the composer branch without rejecting existing media.
- Workspace: Keep the first-project composer at the viewport centre, including with scrollbars, over the chosen violet grain with one headline and starter prompts. Why: make the first edit clear for new users.
- Workspace: Restore the new-project composer’s shared primary-purple send button and remove local color overrides. Why: small primary actions keep the app’s brand color.
- Workspace: Start projects with one composer for prompts and footage, with the editor’s model, effort and mode choices carried into the first request. Why: one place to describe and attach before sending.
- iOS: Prepare the Superwall membership paywall, restore native labels and accents, unify onboarding backgrounds and adapt the editor to resizing. Why: Zura requested App Store payment setup and a consistent native iPhone interface.
- Agent tools: Remove scene image-binding caps, make patches and inspection recover from routine input drift, and support licensed Noto/Fluent emoji with accurate icon errors. Why: Terra hit repeated tool friction while building a motion film.
- Skills: Add renderer-proven 3D craft guidance for materials, lighting, grounding, cameras and licensed models. Why: Zura's cursor review exposed mechanics without visual craft.
- Codebase: Remove unused components and helpers, keep module-only exports private, and simplify timeline comparison, storage helpers and runner startup. Why: the user requested behaviour-preserving cleanup across the web, backend, workers and scripts.
- Landing: Recover interrupted video loads, resume visible films and keep playable posters when autoplay is blocked. Why: Zura reported landing videos sometimes stayed stopped.
- Landing: Replaced the motion-design demo with the final portrait motion study, a matching poster and source credit. Why: showcase the approved Revline film at its native aspect ratio.
- iOS: Add expandable agent and export drawers, fixed Terra medium with Fast/Precise, consent and account deletion, draft legal pages and App Store automation. Why: make editing native and prepare a reviewed store release.
- Incidents: Run fixers as visible T3 MCP threads at xhigh on the Linux PC, with a disabled-by-default systemd listener and non-defect filtering. Why: avoid Mac swapping and wasted Sol sessions.
- Incidents: Capture user and agent failures, group repeats, and start local Sol fixes through Convex subscriptions. Why: turn failures into reviewed draft PRs immediately.
- Audio: Recover silent generated effects with a longer retry, trim short clips from their onset, and retain revision-bound sound and pacing checks. Why: tiny effects could be silent and verification results expired during later edits.
- Reference comparison: Render batches in parallel and return scored revisions with a four-minute resume cursor that retains crop settings, without the 60-sample cap. Why: dense MCP comparisons timed out and lost finished results.
- Media capture: Omit clips exhausted by prepared source windows while preserving timeline length for frames, reference comparisons and browser exports. Why: split, trimmed or retimed narration could leave zero-duration clips and block rendering.
- Reference comparison: Score independent reference and timeline regions, with interpolated reference crop keyframes for pixels and motion. Why: compare moving demo sub-panels directly with full-screen recreations.
- Scenes: Share import rules and renderer bundles across saving, preview, capture and export; require refreshed workers (contract 32). Why: accepted 3D imports could fail when a renderer omitted its bundle.
- Skills: Restore the GSAP revline page using the main rules body. Why: documented readSkill calls failed after the duplicate page was removed.
- Agents: pull request descriptions now say what each change is for and why it was requested, and drop the Tested line. Why: the founder wants to see what each PR is for and what problem it solves at a glance.
- Editor recovery: Resume interrupted edits automatically within the existing repair budget and retry the same chat turn in place. Why: recovery must preserve saved work without duplicate user bubbles.
- Editor chat: Confirm tool saves with atomic revision receipts, shared classifications and portable frame output. Why: saved edits, reads and queued jobs must never produce false save failures.
- Storage: Make shared-media deletion and retries idempotent, report project cleanup failures, and handle disappeared projects calmly. Why: a shared project could abort a multi-file cascade.
- Scenes: Added timeline-driven 3D layers, cameras, lights, models and extruded text beside HTML/GSAP. Why: mix real depth with motion design in preview, frame capture and CPU exports.
- Landing: Mix three gaming clips with three podcast and interview clips, keeping six caption styles. Why: show clipping for both gaming streams and podcasts.
- iOS: Match the website’s dark background, cards, elevated sheets, text and borders using shared named colors. Why: Keep the iPhone app consistent with Revline’s brand.
- Media preparation: Skip Gemini overviews for speech; queue optional visual overviews after transcription and editor opening, with frame-tool fallbacks. Why: transcripts cover speech and Gemini must not block editing.
- Media processing: Unified preview, speaker framing and resumable imports under processor contract 30. Why: workers must support the combined task payloads.
- Playback: prepare timeline ranges first, reuse playable originals, show live encode progress and early posters, and prioritize previews. Why: long uploads should open promptly.
- Imports: reuse existing video assets for repeated source links and document section downloads for agents. Why: avoid downloading and preparing the same footage again.
- iOS: Use native iPhone controls, dark launch and sheets, and a trailing New project tab; fix unsigned Simulator authentication startup. Why: Match iOS interaction and prevent an indefinite loading screen.
- Client: Reuse chat rows and composer controls, and let compact inputs size without forced layout. Why: keep search, dialogs and typing responsive.
- Clipping and VFX: Add subject seeds and segmentation fallback, recover lost tracks, resume VOD imports, range-read media, chunk checks, and decode audio ramps. Why: full-feature checks exposed failures on gameplay and long sources.
- Landing: Gave all six clipping demo tiles distinct caption styles and refreshed their videos, posters and still. Why: Show Revline’s caption range at small tile sizes.
- Media processor: frame podcasts by camera shot, match wide-shot speakers over whole turns, and reuse face identities with stable crops and method/confidence receipts. Why: profiles, microphones and camera cuts often defeated mouth-only tracking.
- Landing: Added a public pricing page, product and FAQ schema, a sitemap, brand assets and cross-page product links. Why: directory listings need stable pricing and machine-readable product facts.
- Landing: hero buttons are smaller on phones and fit inside the page margins. Why: they ran edge to edge at 375 px.
- Landing: Enlarged desktop clipping and motion-design demos to 65% width, added top spacing, and refreshed clipping copy. Why: make the product demos easier to see.
- Landing: Enlarged clipping and motion-design demos, added desktop spacing, and refreshed clipping copy. Why: make demos easier to see while keeping the phone layout readable.
- Audio: Documented loudness measurements and the missing stem separation implementation. Why: preserve verified evidence and the blocker before attempting a runtime fix.
- Media storage (dev): the dev media worker accepts localhost ports 3005 to 3008. Why: agent review servers on those ports could not load footage.
- Media processing: Added Fly workers, parallel preview encoding and a backend switch; production remains on Cloudflare until cutover. Why: Faster processing with a verified rollout and rollback.
- Delivery: pull request descriptions follow a fixed template under 150 words. Why: agents were writing essays.
- Delivery: pull requests that change UI show before and after screenshots, stored on the pr-assets branch. Why: visual changes are reviewed by looking, not by reading diffs.
- Landing: Replaced gaming clips with tech interviews, podcasts and a tech-stream opener. Why: Show clipping for a broader Shorts and Reels audience.
- Delivery: agent work now lands as draft pull requests that the user merges; the building agent writes the description and this entry. Why: changes are easier to review on GitHub before they ship.
