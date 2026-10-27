import { ClaudeLogo, CursorLogo, OpenAILogo } from './ai-app-logos';
import { Brand } from './brand';

/** Who is editing: an MCP app by its name (Claude, ChatGPT/Codex, Cursor), or Revline's own AI when
 * there is no name. Unknown apps have no mark. */
export function AgentLogo({ name, className }: { name?: string | null; className?: string }) {
  if (!name) return <Brand markOnly className={className} />;
  if (/claude|anthropic/i.test(name)) return <ClaudeLogo className={className} />;
  if (/gpt|openai|codex/i.test(name)) return <OpenAILogo className={className} />;
  if (/cursor/i.test(name)) return <CursorLogo className={className} />;
  return null;
}
