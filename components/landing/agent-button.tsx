import { LandingButton } from './ui';

// Official marks from Lobe Icons, shown bare on the button.
const agents = [
  { name: 'Claude', file: 'claude' },
  { name: 'ChatGPT', file: 'openai' },
  { name: 'Codex', file: 'codex' },
  { name: 'Cursor', file: 'cursor' },
];

/** The hero's second action: connect Revline to an AI agent over MCP. */
export function LandingAgentButton() {
  return <LandingButton href="/profile#mcp" variant="neutral" size="md" className="landing-agent-button">
    <span className="landing-agent-logos" aria-hidden="true">{agents.map(agent => <img key={agent.file} src={`/landing/agents/${agent.file}.png`} width={18} height={18} alt="" />)}</span>
    Add to your agent
  </LandingButton>;
}
