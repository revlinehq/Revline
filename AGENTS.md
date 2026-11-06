<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Verification

Never create test files, mocks, fixtures, smoke scripts or any other test-only code. The project intentionally has no test suite. Verify changes with `npm run typecheck`, `npm run build`, and direct runtime or UI inspection.

## Acting as a user

Agents never run Convex functions as a user to get around the MCP tools: no `npx convex run … --identity`, and no calling user-scoped or internal functions (such as `mcpActions:callTool`) with someone's `ownerId` or `subject`. Work only through the MCP tools, which check owner and task; when a tool you need is missing, report it with `reportIssue` and stop.

## UI components

Build every new UI component from shadcn (`components/ui/`): tabs, segments, dialogs, buttons, inputs, selects. Add a missing primitive with the shadcn CLI rather than hand-rolling one. Any prompt or chat input uses the main `EditComposer` (`components/workspace/edit-composer.tsx`), never a new composer. Dark surfaces use neutral greys such as `#2a2a2a`, never blue-tinted ones like `#1D202A`. No focus outlines or rings; hover states mark what is interactive.

## Delivery

Agent worktrees start with `npm run dev:isolated` and use `scripts/isolated-mcp.mjs` for revline-local; details: `docs/isolated-development.md`. Only the primary checkout on `main` may push `majestic-alpaca-541`. Never override a worktree's scoped target.

`npm run dev` runs the frontend and development media worker together. Verify both `[web]` and `[worker]` readiness logs before handing the editor back; keep them running while the user tests media processing. Use the Codex terminal for visible logs when requested.

Work on your own branch and commit there in coherent, verified batches. Never push to or merge into main yourself. Every finished change is reviewed by the user as a draft GitHub pull request and merged only when the user says so.

The agent that built the change writes its pull request, because it knows what it built:
- A short description, under 150 words of prose (tables and images do not count). The founder skims it on GitHub, so write like a changelog, not an essay. Use exactly this shape and nothing else:
  ```
  <one sentence: what the user will notice>

  **What it is for:** <one line: what the feature or fix is for, in plain words>
  **Why:** <one line: why it was requested and what problem it solves (who or what asked: the user, an agent test, an incident)>

  **Changed**
  - <up to 5 bullets, one line each, plain words>

  **Before / after** (only if something is visible)
  | Before | After |

  **Risk:** <one line, or "None">
  ```
  Keep **What it is for** and **Why** short and concrete, not a retelling of the conversation. No file-by-file walkthrough, no list of checks you ran, no headings beyond these. Add a Mermaid diagram only when the change rewires how systems talk to each other.
- An entry in `docs/changelog.md` (newest first, under a `## YYYY-MM-DD` heading): `- <System>: <what changed>. Why: <reason>.`, at most two lines, committed on the branch.
- Before and after screenshots of every page or screen a change touches visibly (web: desktop and phone width; iOS: the Simulator), taken from the running app, never mocked. Do not commit them to your branch: push them to the `pr-assets` branch under `<your-branch>/before/` and `<your-branch>/after/`, and show them in the description as a before | after table per page, linked as `https://github.com/zuraHQ/revline-editor/blob/pr-assets/<path>?raw=true`.
If you were told not to push, hand the description and the screenshot folders to whoever started you, and they open the draft PR with your text unchanged.

After the user approves a merge, deploy every completed Convex change to its intended environment and verify the deployment succeeds. Local development uses the development deployment; the hosted production app uses the production deployment and its own credentials. Identify and announce the target before deploying. Never point production at the development backend. Keep environment files and deployment credentials separate.

## Motion films from a coding session

When building or copying a motion film from here (scene code pushed to a Revline project):
- Read the editor agent's skills first, the same ones Revline's own agent follows: `launch-films-motions`, `gsap` (its `revline` page first), `writing-scenes` (pages `films` and `edit-lanes`) and, when copying a video, `remaking-videos`. Load them with the `readSkill` tool of the worktree's `revline-local` MCP server (after `startTask` on your dev project), which returns the text with live values filled in (allowed fonts, plugins, limits); the files in `lib/ai/skills/` hold template placeholders for those.
- Work on the development deployment, and pass the timeline tab explicitly instead of switching the project's open tab; other sessions may be editing another tab of the same project.
- Measure at full resolution, never from downscaled contact sheets.
- For device mockups, logos and other reusable assets, check the asset-library skill first and record each asset's license before searching the web.
