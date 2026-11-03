# Changelog

Newest first. Each merged pull request adds its lines here, grouped by system.

## 2026-11-02
<<<<<<< HEAD
- Skills: Add motion taste judgments, reference learning and a short rendered critique anchored in user memory. Why: Zura asked for original design judgment beyond replication.
=======
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
>>>>>>> origin/main
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
