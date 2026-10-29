'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, Check, CircleCheck, CircleStop, LoaderCircle, Minus } from 'lucide-react';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { READ_ONLY_TOOLS, toolImages, type ChatTool } from './assistant-results';

type Row = { key: string; tool: string; args: string; state: ChatTool['state']; count: number; span?: [number, number]; images: { label: string; src: string }[] };

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

const timeOf = (step: ChatTool) => {
  const input = step.input ?? {}, start = [input.start, input.time, input.at].find(value => typeof value === 'number' && Number.isFinite(value)) as number | undefined;
  return start === undefined ? undefined : [start, start + (typeof input.duration === 'number' && Number.isFinite(input.duration) ? input.duration : 0)] as [number, number];
};

/** One row per run of the same tool: consecutive successful calls fold into ×N
 * with the timeline range they covered, so 20 captions read as one line. */
export function toolChainRows(steps: ChatTool[]): Row[] {
  const rows: Row[] = [];
  steps.forEach((step, index) => {
    const args = argumentsOf(step), previous = rows.at(-1), time = timeOf(step);
    const images = toolImages(step);
    // Steps with images stay their own row, so every render and diff shows where it was made.
    if (previous && previous.tool === step.name && previous.state === 'done' && step.state === 'done' && !images.length && !previous.images.length) {
      previous.count++;
      if (previous.args !== args) previous.args = '';
      previous.span = previous.span && time ? [Math.min(previous.span[0], time[0]), Math.max(previous.span[1], time[1])] : undefined;
      return;
    }
    // Raw tool errors can carry backend internals; the turn's failure card explains them.
    rows.push({ key: step.id ?? `${step.name}-${index}`, tool: step.name, args, state: step.state, count: 1, images, ...(time ? { span: time } : {}) });
  });
  return rows.map(row => row.count > 1 && !row.args && row.span ? { ...row, args: `${seconds(row.span[0])}–${seconds(row.span[1])}` } : row);
}

/** What a step rendered (frames, a blueprint render and its diff), small under the step; click for full size. */
function StepImages({ images }: { images: { label: string; src: string }[] }) {
  const [open, setOpen] = useState<{ label: string; src: string } | null>(null);
  return <div className="tool-chain-images">
    {images.map((image, index) => <button key={index} type="button" className="tool-chain-image" onClick={() => setOpen(image)} aria-label={`Open ${image.label || 'image'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src} alt={image.label}/>{image.label && <span>{image.label}</span>}
    </button>)}
    <Dialog open={!!open} onOpenChange={value => { if (!value) setOpen(null); }}>
      <DialogContent className="tool-chain-image-dialog"><DialogTitle>{open?.label || 'Image'}</DialogTitle>{open && <img src={open.src} alt={open.label}/>}</DialogContent>
    </Dialog>
  </div>;
}

/** One group of tool calls, shown where it ran. Open while its turn streams; collapses when the turn ends. */
export function ToolChain({ steps: saved, active = false }: { steps: ChatTool[]; active?: boolean }) {
  // A step without a result is running only while its run is live. After Stop,
  // a time limit or a reload it was cut off, not still working.
  const steps = active ? saved : saved.map(step => step.state === 'running' ? { ...step, state: 'stopped' as const } : step);
  const rows = toolChainRows(steps);
  const running = steps.some(step => step.state === 'running'), failed = steps.some(step => step.state === 'error'), stopped = steps.some(step => step.state === 'stopped');
  const [open, setOpen] = useState(active);
  useEffect(() => { setOpen(active); }, [active]);
  if (!rows.length) return null;
  const skill = steps.find(step => step.name === 'readSkill' && typeof step.input?.name === 'string')?.input?.name as string | undefined;
  const count = `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`;
  const label = running ? `Running ${count}` : stopped ? `Stopped after ${count}` : skill && steps.every(step => step.name === 'readSkill') ? `Read skill ${skill}` : steps.every(step => READ_ONLY_TOOLS.has(step.name)) ? 'Checked your project' : `Ran ${count}`;
  const Status = running ? LoaderCircle : failed ? AlertTriangle : stopped ? CircleStop : CircleCheck;
  const tone = running ? 'text-muted-foreground' : failed ? 'text-[#c3853c]' : stopped ? 'text-muted-foreground' : 'text-[#3FB27F]';
  return <TraceCollapsible className="tool-chain" open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger>
      <TraceLine status={running ? 'running' : undefined}>
        <TraceIcon className={tone}><Status className={running ? 'animate-spin' : undefined}/></TraceIcon>
        <TraceTitle className="font-medium text-foreground">{label}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <Trace aria-label="Assistant steps">
        {rows.map(row => {
          const Mark = row.state === 'running' ? LoaderCircle : row.state === 'error' ? AlertTriangle : row.state === 'stopped' ? Minus : Check;
          const mark = row.state === 'error' ? 'text-[#d9a15a]' : row.state === 'done' ? 'text-[#3FB27F]' : 'text-muted-foreground';
          return <Fragment key={row.key}><TraceLine status={row.state === 'running' ? 'running' : row.state === 'error' ? 'error' : row.state === 'stopped' ? 'pending' : undefined}>
            <TraceIcon className={mark}><Mark className={`size-3.5${row.state === 'running' ? ' animate-spin' : ''}`} aria-label={row.state === 'running' ? 'Running' : row.state === 'error' ? 'Failed' : row.state === 'stopped' ? 'Stopped' : 'Done'}/></TraceIcon>
            <TraceTitle className={row.state === 'error' ? undefined : 'text-foreground/85'}>{row.tool}</TraceTitle>
            {(row.args || row.count > 1) && <TraceDescription>{row.args}{row.count > 1 ? `${row.args ? ' ' : ''}×${row.count}` : ''}</TraceDescription>}
            {row.state === 'error' && <TraceDescription>Failed</TraceDescription>}
          </TraceLine>{row.images.length > 0 && <StepImages images={row.images}/>}</Fragment>;
        })}
      </Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

/** The model's summarized thinking, folded into one row like the steps; open it to read all of it. */
export function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  // While it thinks, the newest lines show under the row; opening it shows everything.
  const lines = text.replace(/[*_#`]/g, '').split(/\n+/).map(line => line.trim()).filter(Boolean).slice(-3).join('\n');
  const latest = lines.length > 360 ? lines.slice(-360).replace(/^\S*\s+/, '…') : lines;
  // Opened, it stays on the newest line as the thinking streams.
  const pane = useRef<HTMLParagraphElement>(null);
  const follow = (node: HTMLParagraphElement | null) => { pane.current = node; if (node) node.scrollTop = node.scrollHeight; };
  useEffect(() => { const node = pane.current; if (node) node.scrollTop = node.scrollHeight; }, [text, open]);
  return <TraceCollapsible className="tool-chain thinking-block" open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger>
      <TraceLine status={active ? 'running' : undefined}>
        <TraceIcon className="text-muted-foreground"><Brain/></TraceIcon>
        <TraceTitle className={active ? 'font-medium' : 'font-medium text-foreground'}>{active ? 'Thinking' : 'Thought'}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    {active && !open && latest && <p className="thinking-latest">{latest}</p>}
    <TraceCollapsibleContent>
      <p className="thinking-text" ref={follow}>{text}</p>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}
