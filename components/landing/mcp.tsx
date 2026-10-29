import { Braces } from 'lucide-react';
import { ClaudeLogo, CodexAppIcon, CursorLogo, McpLogo } from '@/components/workspace/ai-app-logos';
import { PUBLIC_MCP_URL } from '@/components/workspace/mcp-apps';
import { LandingButton, LandingHeading, LandingSection } from './ui';

type Token = [text: string, tone?: 'key' | 'string'];

// Revline's MCP server is remote and signs in with OAuth, so clients only need its URL.
const config: Token[][] = [
  [['{']],
  [['  '], ['"mcpServers"', 'key'], [': {']],
  [['    '], ['"revline"', 'key'], [': {']],
  [['      '], ['"type"', 'key'], [': '], ['"http"', 'string'], [',']],
  [['      '], ['"url"', 'key'], [': '], [`"${PUBLIC_MCP_URL}"`, 'string']],
  [['    }']],
  [['  }']],
  [['}']],
];

export function LandingMcp() {
  return <LandingSection id="mcp" className="landing-mcp" headingId="landing-mcp-heading">
    <div className="landing-mcp-copy">
      <div className="landing-mcp-apps" role="img" aria-label="Works with Claude, Codex and Cursor">
        <span data-app="claude"><ClaudeLogo width={28} height={28} fill="#fff" /></span>
        <span data-app="codex"><CodexAppIcon width={54} height={54} /></span>
        <span data-app="cursor"><CursorLogo width={26} height={26} /></span>
      </div>
      <LandingHeading id="landing-mcp-heading" tone="inverse" size="lg" title="Edit videos from any AI agent with MCP" description="Connect any MCP client and edit videos straight from your agent." />
      <LandingButton href="/profile" variant="inverse" size="md" className="landing-mcp-button"><McpLogo width={16} height={16} aria-hidden="true" />Connect Revline</LandingButton>
    </div>
    <figure className="landing-mcp-code">
      <figcaption><Braces size={15} aria-hidden="true" />mcp.json</figcaption>
      <pre><code>{config.map((line, index) => <span key={index}>{line.map(([text, tone], part) => <span key={part} data-tone={tone}>{text}</span>)}{'\n'}</span>)}</code></pre>
    </figure>
  </LandingSection>;
}
