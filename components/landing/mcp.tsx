import { ArrowRight, Braces } from 'lucide-react';
import { LandingButton, LandingHeading, LandingSection } from './ui';

type Token = [text: string, tone?: 'key' | 'string'];

// Revline's MCP server is remote and signs in with OAuth, so clients only need its URL.
const config: Token[][] = [
  [['{']],
  [['  '], ['"mcpServers"', 'key'], [': {']],
  [['    '], ['"revline"', 'key'], [': {']],
  [['      '], ['"type"', 'key'], [': '], ['"http"', 'string'], [',']],
  [['      '], ['"url"', 'key'], [': '], ['"https://tryrevline.com/mcp"', 'string']],
  [['    }']],
  [['  }']],
  [['}']],
];

export function LandingMcp() {
  return <LandingSection id="mcp" className="landing-mcp" headingId="landing-mcp-heading">
    <div className="landing-mcp-copy">
      <LandingHeading id="landing-mcp-heading" tone="inverse" size="lg" title="Edit videos from any AI agent with MCP" description="Connect any MCP client and edit videos straight from your agent." />
      <LandingButton href="/profile" variant="inverse" size="md">Connect Revline<ArrowRight size={16} aria-hidden="true" /></LandingButton>
    </div>
    <figure className="landing-mcp-code">
      <figcaption><Braces size={15} aria-hidden="true" />mcp.json</figcaption>
      <pre><code>{config.map((line, index) => <span key={index}>{line.map(([text, tone], part) => <span key={part} data-tone={tone}>{text}</span>)}{'\n'}</span>)}</code></pre>
    </figure>
  </LandingSection>;
}
