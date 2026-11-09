export type AgentCompany = 'claude' | 'openai' | 'gemini' | 'antigravity' | 'cursor' | 'mcp';
export type WorkingAgent = { id: string; name: string; company: AgentCompany; timelineId: string; until: number };

export const MCP_AGENT_IDLE_MS = 10 * 60_000;
/** The working badge stays up this long after an agent's last call ends, so it does not flicker between calls. */
export const MCP_AGENT_GRACE_MS = 15_000;

export function agentCompany(name: string): AgentCompany {
  if (/antigravity/i.test(name)) return 'antigravity';
  if (/gemini|google/i.test(name)) return 'gemini';
  if (/claude|anthropic/i.test(name)) return 'claude';
  if (/gpt|openai|codex/i.test(name)) return 'openai';
  if (/cursor/i.test(name)) return 'cursor';
  return 'mcp';
}

export function mcpClientName(client: { name: string; title?: string }, fallback: string) {
  const name = client.name.trim(), title = client.title?.trim();
  if (title && agentCompany(title) !== 'mcp') return title.slice(0, 100);
  if (name && agentCompany(name) !== 'mcp') return name.slice(0, 100);
  return (title || name || fallback).slice(0, 100);
}
