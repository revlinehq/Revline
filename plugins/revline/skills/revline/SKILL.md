---
name: revline
description: Edit videos with Revline from Claude Code. Use when the user asks to edit, cut, trim, caption, subtitle, reframe (9:16, 1:1, 16:9), clip, add motion graphics or B-roll to, or export a video or recording, or mentions Revline. Covers connecting the Revline MCP server, uploading local footage, running an edit task to completion and handing back the editor link.
---

# Revline video editing

Revline is a video editor driven over MCP. Every edit call saves immediately to the user's real Revline project, shows live in any open editor tab, and can be undone. This plugin adds the `revline` MCP server at `https://tryrevline.com/mcp`.

## 1. Check the connection

- If no `mcp__revline__*` tools are available, tell the user to run `/mcp`, pick **revline** and sign in. Sign-in opens Revline's OAuth page in the browser; a Revline account is required (3-day free trial, then $39/month).
- Do not ask the user for tokens or API keys. OAuth is the only sign-in.

## 2. Find or create the project

1. `listProjects`. If the user named a project, use it; otherwise ask which one, or `createProject` for new footage.
2. `getProject` returns the timelines and `editorUrl`. Give the user `editorUrl` early so they can watch the edit happen.

## 3. Bring in footage

- Local file: call `uploadMedia` with `projectId`, `filePath`, `fileName` and `contentType` (for example `video/mp4`, `video/quicktime`, `audio/mpeg`, `image/png`). It returns a shell script. Run it with `sh` on this machine; it needs Node 22+ and `ffprobe`. Pass the JSON it prints to `finishUpload`. Upload access expires after 1 hour, so run the script right away.
- A YouTube or other video URL: `importVideoLink`.
- Processing runs in the background. Poll with `getMediaTask` instead of retrying the upload.

## 4. Run the edit as a task

1. `startTask(projectId, timelineId, request)` with the user's request in their own words. Keep the returned `taskId` and pass it with `projectId` on every later call.
2. Use `inspectTimeline` for real clip and asset IDs, and `inspectAssetAnalysis` for the saved transcript. Never invent IDs.
3. Need a capability that isn't loaded? Call `discoverCapabilities` with the action, then `loadCapability`, or `readSkill` for a known skill. A tool tagged `[Needs: …]` names the exact `loadCapability` step in its error.
4. Check the result with `getFrames` (rendered frames) before saying an edit looks right.
5. End every task with `finish`. Only report the work as done when it returns `passed: true`. After 3 failed `finish` calls, stop and tell the user exactly which checks failed.

## 5. Rules

- **Export only after the user confirms.** Show frames with `getFrames`, ask, then call `exportVideo` and poll `getExport`. Exports cost render time. If one is stuck or no longer wanted, stop it with `cancelExport` (no confirmation needed; saved edits stay); a stuck export holds frame checks and the next export.
- To bring back an earlier version, use `listRevisions`, then `restoreSection` or `restoreClip`. Do not chain `undoLatestEdit` to reach an old state.
- If a Revline tool fails unexpectedly or contradicts its description, call `reportIssue` once with the tool name, a short input summary, what happened and what you expected. Never include tokens, user text or media.
- End your reply with the `editorUrl`, not a summary of how the edit was made.
