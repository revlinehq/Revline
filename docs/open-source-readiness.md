# Publication review

This repository is being prepared for public source distribution. Apache 2.0 applies to Revline-authored code; it does not replace third-party licenses or grant media, music, model-weight or trademark rights. Publication must wait until the remaining items below are resolved.

## Changes in this review

- Add the Apache 2.0 license, NOTICE, contribution guidance and a security-reporting policy.
- Patch Zod and compatible transitive dependencies. Override the Sentry bundler plugin\'s glob dependency with patched 14.x; its named async glob API is retained. The application build checks this integration.
- Run redacted Git-history secret scanning and root/agent-runner production dependency audits in the Security workflow on GitHub-hosted runners, and document them for local use. GitHub Actions is enabled; SECURITY.md describes the self-hosted release runner's limits.
- Ignore local agent notes, logs and signing files. Existing ignore rules already exclude real environment files; `.env.example` contains configuration placeholders.
- Keep README setup independent of hosted Revline credentials and free of em dashes.

## Credential review

The local audit scans all locally reachable Git refs, including historical commits, with Gitleaks 8.30.1. Results and logs stay in ignored `.data/security/` and are not published. A scan cannot inspect unknown forks, deleted remote refs, image pixels, external CI logs or credentials that were shared outside Git. Public client keys and deployment/account identifiers are configuration, not private authentication credentials.

GitHub reported secret scanning disabled for the private repository. Enabling private vulnerability reporting through the API returned 404. The owner must enable the available reporting and push-protection features in GitHub settings when supported; no paid security feature is enabled automatically.

If a real credential is found, revoke it at its provider, examine usage, and replace it independently in every affected environment. History cleanup alone does not invalidate it. Coordinate any history rewrite with contributors before force-pushing.

## Media rights: publication blockers

The existing provenance in `assets/landing-media/README.md` explicitly does not establish redistribution rights for:

- `public/demo/f1-edit/`: film footage and commercial music from the F1 edit, including video, extracted audio and poster derivatives.
- `public/demo/hormozi-distractions.mp4` and related interview-derived examples: a third-party interview excerpt.

Obtain redistribution permission or replace these assets and their references before public distribution. They also exist in prior commits, so deleting only the current files does not remove them from public Git history. The repository\'s `pr-assets` branch and other image/video assets require the same provenance review. NASA and OFL-font provenance is documented separately; keep the original notices. No rights are inferred merely from an asset being downloadable.

## Scope and remaining review

The source review checks media-route authentication, ownership-backed queue admission, signed upload tickets, development-only diagnostics, MCP bearer authentication and process-launch call sites. It is not an independent penetration test or a guarantee of vulnerability absence. Before opening a production instance, review scene isolation, URL fetch/redirect protections, per-owner authorization, signed media URLs, provider spend limits, webhook verification and deployment-token scopes.

Do not change repository visibility, rewrite shared history, publish private container images or alter production credentials as a side effect of this PR.

## Verification for this draft

Root and agent-runner `npm audit --omit=dev` reported zero advisories after the dependency updates. Root typecheck and production build passed with non-secret CI public configuration. Processor-edge typecheck passed. The staged-change credential scan passed. The published remote/tag history scan found five generic-key false positives: two documented API SHA-256 hashes, a GitHub Actions cache key, and two public Clerk publishable keys. Each is exempted only by its exact historical fingerprint in `.gitleaksignore`; future commits remain scanned. No private credential was identified in those five findings. Unpublished local branches contain captured third-party pages and many additional scanner candidates; they are outside the public branch history reviewed here and must not be published without a separate review. Public redistribution remains blocked on the media-rights review above.
