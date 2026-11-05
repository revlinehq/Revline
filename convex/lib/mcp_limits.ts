// Time budgets for one MCP tool call, kept together because each must stay inside the one above it.

/** One MCP tool call is one AI run; the run lock and live preview are released after this long even if the call never ends. */
export const MCP_RUN_LIMIT = 11 * 60_000;
/** An MCP call runs in one Convex action; stop it with a clear message before the ten-minute action limit,
 * and so before the run lock above expires while the call still holds it. */
export const CALL_LIMIT_MS = MCP_RUN_LIMIT - 2 * 60_000;
/** The longest one MCP call waits on the media worker (an analysis, a blueprint check, a guard render),
 * shorter than the MCP transport allows a single call. */
export const MCP_WORKER_WAIT_MS = 170_000;
