/** Read-only MCP calls (inspectTimeline, inspectClip, readSkill) read through getRun without holding the edit lock. */
export const READ_ONLY_RUN_PREFIX = 'mcp-read-';
/** A read-only run of a named timeline tab carries the tab in its id: mcp-read-tab:<timelineId>:<uuid>. */
export const readRunId = (timelineId?: string) => `${READ_ONLY_RUN_PREFIX}${timelineId ? `tab:${timelineId}:` : ''}${crypto.randomUUID()}`;
export function readRunTab(runId: string) {
  const rest = runId.slice(READ_ONLY_RUN_PREFIX.length);
  if (!rest.startsWith('tab:')) return undefined;
  const end = rest.lastIndexOf(':');
  return end > 4 ? rest.slice(4, end) : undefined;
}

/** Exclusive MCP calls bind a tab without changing the editor selection. */
export function mcpRunTab(runId: string) {
  if (!runId.startsWith('mcp-') || runId.startsWith(READ_ONLY_RUN_PREFIX)) return undefined;
  return runId.split(':tab:')[1];
}

/** The tab a read-only or exclusive MCP run is bound to; in-app runs use the open tab and return undefined. */
export const boundRunTab = (runId: string) => runId.startsWith(READ_ONLY_RUN_PREFIX) ? readRunTab(runId) : mcpRunTab(runId);
