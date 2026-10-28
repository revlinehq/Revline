import { ArrowRight } from 'lucide-react';
import { LandingButton, LandingHeading, LandingSection } from './ui';

// Official marks from Lobe Icons, shown as app tiles.
const agents = [
  { name: 'Claude', file: 'claude' },
  { name: 'ChatGPT', file: 'openai' },
  { name: 'Codex', file: 'codex' },
  { name: 'Cursor', file: 'cursor' },
  { name: 'MCP', file: 'mcp' },
];

export function LandingMcp() {
  return <LandingSection id="mcp" className="landing-mcp" headingId="landing-mcp-heading">
    <div className="landing-mcp-copy">
      <ul className="landing-mcp-agents" aria-label="Works with Claude, ChatGPT, Codex, Cursor and any MCP client">{agents.map(agent => <li key={agent.file}><img src={`/landing/agents/${agent.file}.webp`} width={40} height={40} alt={agent.name} /></li>)}</ul>
      <LandingHeading id="landing-mcp-heading" align="center" tone="inverse" size="lg" title="Edit videos from any AI agent with MCP" description="Connect any MCP client and edit videos straight from your agent." />
      <LandingButton href="/profile" variant="inverse" size="md" className="landing-mcp-button">Connect Revline<ArrowRight size={16} aria-hidden="true" /></LandingButton>
    </div>
  </LandingSection>;
}
