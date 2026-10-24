'use client';

import { AlertTriangle, BookOpen, ChevronRight, Eye, LoaderCircle, PenLine, Search } from 'lucide-react';
import { READ_ONLY_TOOLS, TOOL_LABELS, type ChatTool } from './assistant-results';

type Link = { key: string; kind: 'skill' | 'inspect' | 'review' | 'edit'; label: string; state: ChatTool['state']; count: number; detail?: string };

const REVIEWS = new Set(['planEffects', 'previewRender']);
const ICONS = { skill: BookOpen, inspect: Search, review: Eye, edit: PenLine };

/** One link per tool call in order; consecutive repeats of the same step fold into ×N. */
export function toolChainLinks(steps: ChatTool[]): Link[] {
  const links: Link[] = [];
  steps.forEach((step, index) => {
    const skill = step.name === 'readSkill' && typeof step.input?.name === 'string' ? step.input.name : undefined;
    const kind = skill !== undefined ? 'skill' : REVIEWS.has(step.name) ? 'review' : READ_ONLY_TOOLS.has(step.name) ? 'inspect' : 'edit';
    const names = TOOL_LABELS[step.name];
    const label = skill !== undefined ? `Skill · ${skill}` : names ? names[step.state === 'running' ? 0 : 1] : step.name;
    const previous = links.at(-1);
    if (previous && previous.label === label && previous.state === step.state && step.state !== 'error') { previous.count++; return; }
    links.push({ key: step.id ?? `${step.name}-${index}`, kind, label, state: step.state, count: 1, detail: step.state === 'error' ? step.detail : undefined });
  });
  return links;
}

/** What the assistant did, step by step: skills it read, what it inspected, edited and reviewed. */
export function ToolChain({ steps }: { steps: ChatTool[] }) {
  const links = toolChainLinks(steps);
  if (!links.length) return null;
  return <ol className="tool-chain" aria-label="Assistant steps">
    {links.map((link, index) => {
      const Icon = link.state === 'running' ? LoaderCircle : link.state === 'error' ? AlertTriangle : ICONS[link.kind];
      return <li key={link.key} className={`tool-chain-link kind-${link.kind} state-${link.state}`} title={link.detail}>
        {index > 0 && <ChevronRight className="tool-chain-arrow" size={11} aria-hidden/>}
        <span className="tool-chain-chip"><Icon size={11} className={link.state === 'running' ? 'animate-spin' : undefined} aria-hidden/>{link.label}{link.count > 1 && <b>×{link.count}</b>}</span>
      </li>;
    })}
  </ol>;
}
