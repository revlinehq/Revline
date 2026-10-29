import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { editorTurnArgs, runEditorTurn } from "./lib/editorTurn";

/** The turn inside Convex, for deployments without the Cloudflare agent runner (AGENT_RUNNER_URL). Convex
 * ends any action at ten minutes, so long turns belong on the runner. */
export const respond = internalAction({ args: editorTurnArgs, returns: v.null(), handler: (ctx, args) => runEditorTurn(ctx, args) });
