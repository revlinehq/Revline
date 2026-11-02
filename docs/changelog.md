# Changelog

Newest first. Each merged pull request adds its lines here, grouped by system.

## 2026-11-02
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
