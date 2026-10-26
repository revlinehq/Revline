import { ClaudeLogo, CodexAppIcon, CursorLogo, McpLogo } from '@/components/workspace/ai-app-logos';
import { LandingButton, LandingSection } from './ui';

/** A compact banner: Revline's MCP server works from the AI apps people already use. */
export function LandingMcp() {
  return <LandingSection id="mcp" className="landing-mcp" headingId="landing-mcp-heading">
    <div className="landing-mcp-card">
      <div className="landing-mcp-apps" aria-hidden="true">
        <span data-app="claude"><ClaudeLogo width={36} height={36} fill="#fff" /></span>
        <span data-app="codex"><CodexAppIcon width={68} height={68} /></span>
        <span data-app="cursor"><CursorLogo width={34} height={34} /></span>
      </div>
      <div className="landing-mcp-copy">
        <h2 id="landing-mcp-heading">Run Revline from the AI tools you already use</h2>
        <p>Connect Revline to Claude, Codex, Cursor, or any other AI client to create and edit videos.</p>
      </div>
      <LandingButton href="/profile" variant="neutral" size="sm" className="landing-mcp-button"><McpLogo width={18} height={18} />Explore Revline MCP</LandingButton>
    </div>
  </LandingSection>;
}
