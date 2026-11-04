# Changelog

Newest first. Each merged pull request adds its lines here, grouped by system.

## 2026-11-03
- Clipping: Let Gemini judge whole-source highlights and verify each accepted clip tab with data checks and one framing sheet. Why: the user wanted faster whole-source discovery and honest delivery where clips found equal tabs made.
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
