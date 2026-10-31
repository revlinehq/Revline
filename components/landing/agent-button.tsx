import { LandingButton } from './ui';

// Official marks from Lobe Icons, the same tiles as the MCP section.
const agents = [
  { name: 'Claude', file: 'claude' },
  { name: 'ChatGPT', file: 'openai' },
  { name: 'Codex', file: 'codex' },
  { name: 'Cursor', file: 'cursor' },
];

/** The hero's second action: connect Revline to an AI agent over MCP. */
export function LandingAgentButton() {
  return <LandingButton href="/profile" variant="neutral" size="md" className="landing-agent-button">
    <span className="landing-agent-logos" aria-hidden="true">{agents.map(agent => <img key={agent.file} src={`/landing/agents/${agent.file}.webp`} width={20} height={20} alt="" />)}</span>
    Add to your agent
  </LandingButton>;
}
