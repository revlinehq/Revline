import { Badge } from '@/components/ui/badge';
import type { WorkingAgent } from '@/lib/mcp/agent-identity';
import { AgentLogo } from './agent-logo';
import './working-agents.css';

export function WorkingAgents({ agents }: { agents: readonly WorkingAgent[] }) {
  const connections=[...new Map(agents.map(agent=>[agent.id,agent])).values()].sort((a,b)=>a.company.localeCompare(b.company)||a.id.localeCompare(b.id));
  if(!connections.length)return null;
  return <span className="working-agents" role="group" aria-label="Agents working on this project">{connections.map(agent=><Badge key={agent.id} variant="secondary" className="working-agent" role="img" aria-label={`${agent.name} is working`} title={`${agent.name} is working`} data-company={agent.company}><AgentLogo name={agent.name} company={agent.company}/></Badge>)}</span>;
}
