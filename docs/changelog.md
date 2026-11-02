# Changelog

Newest first. Each merged pull request adds its lines here, grouped by system.

## 2026-11-02
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
