import { ClaudeLogo, CursorLogo, GeminiLogo, McpLogo, OpenAILogo } from './ai-app-logos';
import { Brand } from './brand';
import { agentCompany, type AgentCompany } from '@/lib/mcp/agent-identity';

/** Who is editing: an MCP app by its name (Claude, ChatGPT/Codex, Gemini, Cursor), or Revline's own AI when
 * there is no name. Unknown apps show the MCP mark. */
export function AgentLogo({ name, company, className }: { name?: string | null; company?: AgentCompany; className?: string }) {
  if (!name) return <Brand markOnly className={className} />;
  const source=company??agentCompany(name);
  if (source==='gemini') return <GeminiLogo className={className} />;
  if (source==='claude') return <ClaudeLogo className={className} />;
  if (source==='openai') return <OpenAILogo className={className} />;
  if (source==='cursor') return <CursorLogo className={className} />;
  return <McpLogo className={className} />;
}
