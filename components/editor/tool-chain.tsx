'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, CircleCheck, LoaderCircle } from 'lucide-react';
import { READ_ONLY_TOOLS, type ChatTool } from './assistant-results';

type Row = { key: string; tool: string; args: string; state: ChatTool['state']; count: number };

const short = (value: string, length = 32) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(2))}s` : undefined;

/** A short human hint from a tool's own input; never IDs or error text. */
function argumentsOf(step: ChatTool) {
  const input = step.input ?? {};
  const text = (key: string) => typeof input[key] === 'string' && input[key] ? short(String(input[key])) : undefined;
  if (step.name === 'readSkill') return text('name') ?? '';
  const parts = [text('title') ?? text('text') ?? text('look') ?? text('preset') ?? text('animation') ?? text('mode') ?? text('question'), seconds(input.start) ?? seconds(input.time) ?? seconds(input.at), seconds(input.duration)];
  const ids = Array.isArray(input.clipIds) ? input.clipIds.length : 0;
  if (ids > 1) parts.push(`${ids} clips`);
  return parts.filter(Boolean).join(' · ');
}

/** One row per tool call in order; identical consecutive calls fold into ×N. */
export function toolChainRows(steps: ChatTool[]): Row[] {
  const rows: Row[] = [];
  steps.forEach((step, index) => {
    const args = argumentsOf(step), previous = rows.at(-1);
    if (previous && previous.tool === step.name && previous.args === args && previous.state === step.state && step.state === 'done') { previous.count++; return; }
    // Raw tool errors can carry backend internals; the turn's failure card explains them.
    rows.push({ key: step.id ?? `${step.name}-${index}`, tool: step.name, args, state: step.state, count: 1 });
  });
  return rows;
}

/** One group of tool calls, shown where it ran. It stays open while running and collapses when done. */
export function ToolChain({ steps }: { steps: ChatTool[] }) {
  const rows = toolChainRows(steps);
  const running = steps.some(step => step.state === 'running'), failed = steps.some(step => step.state === 'error');
  const [open, setOpen] = useState(running);
  useEffect(() => { setOpen(running); }, [running]);
  if (!rows.length) return null;
  const skill = steps.find(step => step.name === 'readSkill' && typeof step.input?.name === 'string')?.input?.name as string | undefined;
  const count = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  const label = running ? `Running ${count}` : skill && steps.every(step => step.name === 'readSkill') ? `Read skill ${skill}` : steps.every(step => READ_ONLY_TOOLS.has(step.name)) ? 'Checked your project' : `Ran ${count}`;
  const Status = running ? LoaderCircle : failed ? AlertTriangle : CircleCheck;
  return <div className={`tool-chain${failed ? ' has-error' : ''}`} data-open={open || undefined}>
    <button type="button" className="tool-chain-root" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <Status size={14} className={`tool-chain-status-icon${running ? ' animate-spin' : ''}`} aria-hidden/>
      <span className="tool-chain-label">{label}</span>
      <ChevronDown size={13} className="tool-chain-chevron" aria-hidden/>
    </button>
    {open && <ol className="tool-chain-rows" aria-label="Assistant steps">
      {rows.map((row, index) => {
        const Mark = row.state === 'running' ? LoaderCircle : row.state === 'error' ? AlertTriangle : Check;
        return <li key={row.key} className={`tool-chain-row state-${row.state}${index === rows.length - 1 ? ' is-last' : ''}`}>
          <span className="tool-chain-branch" aria-hidden><span className="tool-chain-stem"/><span className="tool-chain-elbow"/></span>
          <Mark size={12} className={`tool-chain-mark${row.state === 'running' ? ' animate-spin' : ''}`} aria-label={row.state === 'running' ? 'Running' : row.state === 'error' ? 'Failed' : 'Done'}/>
          <span className="tool-chain-text"><span className="tool-chain-tool">{row.tool}</span>{(row.args || row.count > 1) && <span className="tool-chain-args">{row.args}{row.count > 1 ? `${row.args ? ' ' : ''}×${row.count}` : ''}</span>}</span>
          {row.state === 'error' && <span className="tool-chain-status">Failed</span>}
        </li>;
      })}
    </ol>}
  </div>;
}
