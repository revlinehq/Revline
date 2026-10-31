<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification

Never create test files, mocks, fixtures, smoke scripts or any other test-only code. The project intentionally has no test suite. Verify changes with `npm run typecheck`, `npm run build`, and direct runtime or UI inspection.

## UI components

Build every new UI component from shadcn (`components/ui/`): tabs, segments, dialogs, buttons, inputs, selects. Add a missing primitive with the shadcn CLI rather than hand-rolling one. Any prompt or chat input uses the main `EditComposer` (`components/workspace/edit-composer.tsx`), never a new composer. Dark surfaces use neutral greys such as `#2a2a2a`, never blue-tinted ones like `#1D202A`. No focus outlines or rings; hover states mark what is interactive.

## Delivery

Start local development with `npm run dev`, which runs the frontend and development media worker together. Verify both `[web]` and `[worker]` readiness logs before handing the editor back; keep them running while the user tests media processing. Use the Codex terminal for visible logs when requested.

Commit and push every completed change automatically in coherent, verified batches. Push each finished batch while continuing larger tasks. The user explicitly requested this as the standing default; honor any later instruction to keep work local.

Deploy every completed Convex change to its intended environment and verify the deployment succeeds. Local development uses the development deployment; the hosted production app uses the production deployment and its own credentials. Identify and announce the target before deploying. Never point production at the development backend. Keep environment files and deployment credentials separate.

## Motion films from a coding session

When building or copying a motion film from here (scene code pushed to a Revline project):
- Read the editor agent's skills first, the same ones Revline's own agent follows: `motion-design`, `gsap` (its `revline` page first), `scene-engine` (pages `react-scenes` and `checklist`) and, when copying a video, `reference-footage`. Load them with `readSkill` on the development deployment, which returns the text with live values filled in (allowed fonts, plugins, limits); the files in `lib/ai/skills/` hold template placeholders for those:
  `npx convex run mcpActions:callTool '{"ownerId":"<your dev owner id>","agentName":"Claude Code","name":"readSkill","arguments":{"projectId":"<a dev project id>","name":"scene-engine","page":"checklist"}}'`
- Work on the development deployment, and pass the timeline tab explicitly instead of switching the project's open tab; other sessions may be editing another tab of the same project.
- Measure at full resolution, never from downscaled contact sheets.
- For device mockups, logos and other reusable assets, check the asset-library skill first and record each asset's license before searching the web.
