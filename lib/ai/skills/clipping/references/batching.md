---
name: "batching"
description: "One project and shared source analysis, one titled timeline tab per short, separate exports only when requested."
---
# A batch of separate shorts

One source, one project, shared assets and saved analysis; one titled tab per accepted short, each starting at timeline 0.

## Workflow
1. Find the project. Reuse the current project when it contains the source; on MCP call getProject and listTimelines first, and createProject only if a project is needed.
2. Bring a missing source in once: uploadMedia/finishUpload, or importVideoLink for YouTube, Twitch VOD or clip, Kick recording, other supported video-site or direct video-file links. One import brings in at most 3 hours: a longer stream VOD comes in as start/end ranges, each its own source.
3. Persist the accepted list with planClips: candidate ID, title, source range and, once known, the resulting timelineId. Skip this step when the user gave the source ranges: there are no candidates to register.
4. For each accepted candidate or given range, createTimeline from blank with the short's title as its name, using the aspect ratio findHighlights returned.
5. Add the chosen range with addMedia from the shared asset at start 0, then inspect the new clip IDs before any reframing or polish.
6. Build every accepted tab, then call finishClipping and finish, and report its finalMessage. For given ranges call finish alone and report the tabs it checked.
7. Export only when asked: exportVideo once per finished tab with its timelineId, poll getExport for each job, and label each download by title. cancelExport stops a stuck or unwanted job.

## Rules
Sources:
- Never create a project, upload or transcribe the same source once per short.
- If a provider blocks a recording, ask for an upload or a direct video-file link.
- Never claim an unsupported or live stream was imported.

Tabs:
- One tab holds one short. Do not substitute a montage in one tab, or one project per short, unless the user asked for a montage or trailer short: then that one tab cuts several ranges of one moment, its accepted start/end are the tab's retained source span (first in to last out, bound by timelineId), the 15–60 s rule applies to the tab's duration, and the hook and payoff must sit in retained footage.
- On retries, inspect existing tabs and resume completed work instead of duplicating it.
- Use openTimeline to revisit an existing short when the editing surface needs it.
- Preserve unrelated tabs and edits.
- On MCP, pass projectId and the intended timelineId explicitly to every editing and inspection tool, including getFrames, so another session switching tabs cannot redirect work.
- Timeline tabs, imports and exports work the same in MCP and the in-app turn.

Close-out:
- A failed optional check is a real finding: fix the affected tab or report it. Do not hide it or rerender unrelated passing tabs.
- Report checkClip's sampled scope honestly.
- Never export the open tab repeatedly assuming it selects different shorts.
- An optional overview may list title, source range, duration, score and tab or export link. Do not wait for approval of it before building requested shorts.

## Example
For accepted candidate H2 (source 812.4–851.0 s, title "The upload stalled"):

```
createTimeline { from: "blank", name: "The upload stalled", aspectRatio: "landscape" }
addMedia { assetId: "<shared source>", sourceStart: 812.4, duration: 38.6, start: 0 }
inspectTimeline
```
