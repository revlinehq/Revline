<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Delivery

Commit and push every completed change automatically in coherent, verified batches. Push each finished batch while continuing larger tasks. The user explicitly requested this as the standing default; honor any later instruction to keep work local.

Deploy every completed Convex change to its intended environment and verify the deployment succeeds. Local development uses the development deployment; the hosted production app uses the production deployment and its own credentials. Identify and announce the target before deploying. Never point production at the development backend. Keep environment files and deployment credentials separate.
