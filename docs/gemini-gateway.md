# Gemini through Convex AI Gateway

Gemini calls try `GOOGLE_GENERATIVE_AI_API_KEY` first. Missing credentials, HTTP 401/402, billing or authentication 403 responses, exhausted-quota 429 responses, and Google's explicit invalid-key 400 responses fall back once to the same Gemini model through Convex. Ordinary invalid-input 400 responses, transient rate limits and network errors do not switch routes. A partially generated editor stream is never replayed.

The media worker posts to `/media/gemini` using the active task's lease. The external editor runner uses `/agent-runner/gemini` with its existing signed run grant and claim. Both HTTP actions mint a deployment-scoped token immediately before calling the Gateway; no token is returned, written to a file or added to a worker environment. Workers need their existing deployment URL and task or run credentials.

## Models and inputs

The [Gateway catalog](https://docs.convex.dev/ai-gateway/models) lists both Revline defaults, `google/gemini-3.7-flash` for analysis and `google/gemini-4-argon` for editing, alongside Gemini 2.5, 3/3.1 preview and 3.5–3.8 models. A configured model must exist in that catalog; requests never substitute a different model.

Frame inspection, facecam, object grounding and composition review send the same images, labels, prompts and JSON schemas through Chat Completions. Images are not resized by the fallback. The [HTTP API](https://docs.convex.dev/ai-gateway/api) limits the complete JSON body to 16 MiB, including base64 expansion. Oversized requests fail explicitly; narrow the requested window or request fewer frames.

The documented Gateway API does not expose Google's Files uploads or Interactions API. Native video analysis, agentic video search and listening to a reference therefore still need direct Google access. They fail with an explicit explanation when direct access is unavailable. Sampled frames cannot preserve the original audio or agentic video navigation, so the fallback never silently replaces a video with frames. `inspectFrames` remains available for an explicitly visual-only question. The Gateway's video endpoints generate videos; they do not replace Gemini video inspection.

## Access and accounting

The [Gateway requires a paid Convex team with Gateway access](https://docs.convex.dev/ai-gateway/overview). Token errors such as `AiGatewayDisabled`, `AiGatewayUnavailable` and `SpendingLimitExceeded` are reported without exposing credentials. Production needs Gateway access and sufficient spending allowance on its own team/deployment; development configuration does not enable production.

With the existing `AI_COST_DASHBOARD_ENABLED=true` setting, `aiCostRecords` stores each completed Gemini call with `route: direct` or `route: convex-gateway`. Media records are bound to the task's owner/project and analysis run when present. Token counts and any returned USD cost are recorded; missing prices remain unknown. Convex also records Gateway spend against the calling project/function and bills it as [Convex AI Gateway usage](https://docs.convex.dev/ai-gateway/usage-and-billing).
