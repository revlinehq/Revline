---
name: "clipping"
description: "Turn a long stream, VOD or podcast into separate shorts: \"clip this\", \"make clips\", \"turn this into shorts\", \"find the best moments\", or a Twitch, Kick or YouTube source link with a short-form ask. Source-wide transcript search, bounded targeted video discovery, ranked hooks, 15 to 60 second clips and one timeline tab per clip; facecam splits and speaker reframing only when requested. Small existing-clip edits use scene-engine page edit-lanes."
---
# Clipping long sources into shorts

Read moments before findHighlights and batching before planClips. Choose by content: podcast/interview/talk or requested stream dialogue uses transcript/voice (speechLed:true); gaming/sports commentary does not remove the need to understand visual action. findHighlights returns saved words/helpers without a whole-source Gemini job. For visual candidates use short, explicit inspectVideo windows, extend only uncertainty, and reuse observations. Silent content uses bounded adaptive native-video discovery and honest inspected coverage. Stills/cuts alone cannot prove an action.

Build 15–60s shorts in one project/shared upload, one named populated tab per accepted candidate. Preserve source framing and audio unless the user asks otherwise. NO automatic normalization or heavy QA for any clipping type. finishClipping performs cheap data checks directly; then finish closes the lane. checkClip is optional, scoped to an explicit concern, cached for unchanged tabs and never implicitly requires normalization. Pass timelineId on MCP; export only when asked. Never claim skipped checks passed or unsupported action was observed.
