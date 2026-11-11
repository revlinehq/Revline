'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, Check, CircleCheck, CircleStop, LoaderCircle, Minus } from 'lucide-react';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { toolImages } from './assistant-results';
import { assistantErrorDetail } from './assistant-turn-presentation';
import { runWords, type RunStep, type ThoughtEntry } from './assistant-run';

type Image = { label: string; src: string };
type Row = { key: string; tool: string; plain: boolean; args: string; state: RunStep['state']; detail?: string; count: number; span?: [number, number]; images: Image[] };

const short = (value: string, length = 32) => value.length > length ? `${value.slice(0, length - 1)}…` : value;
const seconds = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(2))}s` : undefined;

/** A short human hint from a tool's own input; never IDs or error text. */
function argumentsOf(step: RunStep) {
  const input = step.input ?? {};
  const text = (key: string) => typeof input[key] === 'string' && input[key] ? short(String(input[key])) : undefined;
  if (step.name === 'readSkill') return text('name') ?? '';
  const parts = [text('title') ?? text('text') ?? text('look') ?? text('preset') ?? text('animation') ?? text('mode') ?? text('question'), seconds(input.start) ?? seconds(input.time) ?? seconds(input.at), seconds(input.duration)];
  const ids = Array.isArray(input.clipIds) ? input.clipIds.length : 0;
  if (ids > 1) parts.push(`${ids} clips`);
  return parts.filter(Boolean).join(' · ');
}

const timeOf = (step: RunStep) => {
  const input = step.input ?? {}, start = [input.start, input.time, input.at].find(value => typeof value === 'number' && Number.isFinite(value)) as number | undefined;
  return start === undefined ? undefined : [start, start + (typeof input.duration === 'number' && Number.isFinite(input.duration) ? input.duration : 0)] as [number, number];
};

/** One row per run of the same tool: consecutive successful calls fold into ×N with the timeline range they covered. */
function stepRows(steps: RunStep[]): Row[] {
  const rows: Row[] = [];
  for (const step of steps) {
    const args = step.plain ? '' : argumentsOf(step), previous = rows.at(-1), time = step.plain ? undefined : timeOf(step);
    const images = step.plain ? [] : toolImages(step);
    // Steps with images stay their own row, so every render shows where it was made.
    if (previous && previous.tool === step.name && previous.state === 'done' && step.state === 'done' && !images.length && !previous.images.length) {
      previous.count++;
      if (previous.args !== args) previous.args = '';
      previous.span = previous.span && time ? [Math.min(previous.span[0], time[0]), Math.max(previous.span[1], time[1])] : undefined;
      continue;
    }
    rows.push({ key: step.key, tool: step.name, plain: !!step.plain, args, state: step.state, detail: step.detail, count: 1, images, ...(time ? { span: time } : {}) });
  }
  return rows.map(row => row.count > 1 && !row.args && row.span ? { ...row, args: `${seconds(row.span[0])}–${seconds(row.span[1])}` } : row);
}

/** What a step rendered (frames), small under the step; click for full size. */
function StepImages({ images }: { images: Image[] }) {
  const [open, setOpen] = useState<Image | null>(null);
  return <div className="run-step-images">
    {images.map((image, index) => <button key={index} type="button" className="run-step-image" onClick={() => setOpen(image)} aria-label={`Open ${image.label || 'image'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src} alt={image.label}/>{image.label && <span>{image.label}</span>}
    </button>)}
    <Dialog open={!!open} onOpenChange={value => { if (!value) setOpen(null); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <DialogContent className="run-step-image-dialog"><DialogTitle>{open?.label || 'Image'}</DialogTitle>{open && <img src={open.src} alt={open.label}/>}</DialogContent>
    </Dialog>
  </div>;
}

/** One step on one line: what it does in plain words and its state. A failure names its reason; the rest is on click. */
function StepRow({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const words = row.plain ? [row.tool, row.tool] as const : runWords(row.tool);
  const Mark = row.state === 'running' ? LoaderCircle : row.state === 'error' ? AlertTriangle : row.state === 'stopped' ? Minus : Check;
  const tone = row.state === 'error' ? 'text-[#d9a15a]' : row.state === 'done' ? 'text-[#3FB27F]' : 'text-muted-foreground';
  const reason = row.state === 'error' ? row.detail || assistantErrorDetail(undefined) : '';
  const line = <TraceLine className="run-step-line" status={row.state === 'stopped' ? 'pending' : undefined}>
    <TraceIcon className={tone}><Mark className={`size-3.5${row.state === 'running' ? ' animate-spin' : ''}`} aria-label={row.state === 'running' ? 'Running' : row.state === 'error' ? 'Failed' : row.state === 'stopped' ? 'Stopped' : 'Done'}/></TraceIcon>
    <TraceTitle className="shrink-0 text-foreground/85">{row.state === 'done' ? words[1] : words[0]}</TraceTitle>
    {row.count > 1 && <TraceDescription>×{row.count}</TraceDescription>}
    {row.state === 'stopped' && <TraceDescription>stopped</TraceDescription>}
    {reason && <span className="run-step-reason">failed · {reason}</span>}
  </TraceLine>;
  const details = !!(row.args || reason || row.images.length || !row.plain);
  if (!details) return <div className="run-step">{line}</div>;
  return <TraceCollapsible className="run-step" open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger className="focus-visible:ring-0">{line}</TraceCollapsibleTrigger>
    <TraceCollapsibleContent className="run-step-details">
      <p className="run-step-tool">{row.tool}{row.args ? ` · ${row.args}` : ''}</p>
      {reason && <p className="run-step-full-reason">{reason}</p>}
      {row.images.length > 0 && <StepImages images={row.images}/>}
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}

/** The run's steps, compact: one "N steps" row that opens to a line per step. While the run works, the current
 * step shows under it; when it is done, every step is inside. Collapsed until opened; nothing is remembered. */
export function RunSteps({ steps, active }: { steps: RunStep[]; active: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const current = active ? steps.at(-1) : undefined;
  const earlier = current ? steps.slice(0, -1) : steps;
  const failed = earlier.filter(step => step.state === 'error').length, stopped = earlier.some(step => step.state === 'stopped');
  const Status = failed ? AlertTriangle : stopped ? CircleStop : CircleCheck;
  const tone = failed ? 'text-[#c3853c]' : stopped ? 'text-muted-foreground' : 'text-[#3FB27F]';
  return <div className="run-steps">
    {earlier.length > 0 && <TraceCollapsible className="run-row" open={open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger className="focus-visible:ring-0">
        <TraceLine>
          <TraceIcon className={tone}><Status/></TraceIcon>
          <TraceTitle className="font-medium text-foreground">{stopped && !active ? 'Stopped after ' : ''}{earlier.length} {earlier.length === 1 ? 'step' : 'steps'}</TraceTitle>
          {failed > 0 && <TraceDescription>{failed} failed</TraceDescription>}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace aria-label="Assistant steps" className="gap-1.5">{stepRows(earlier).map(row => <StepRow key={row.key} row={row}/>)}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>}
    {current && <Trace className="run-current" aria-label="Current step"><StepRow key={current.key} row={stepRows([current])[0]}/></Trace>}
  </div>;
}

/** All of a run's reasoning as one row, updated in place as the run goes. Collapsed it reads "Thinking…" with the
 * newest line while the run works; opened, it shows every thought in order, with the steps taken in between. */
export function RunThought({ entries, latest, active }: { entries: ThoughtEntry[]; latest: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  // Opened while the run works, it stays on the newest line.
  const pane = useRef<HTMLDivElement>(null);
  const follow = (node: HTMLDivElement | null) => { pane.current = node; if (node && active) node.scrollTop = node.scrollHeight; };
  useEffect(() => { const node = pane.current; if (node && active) node.scrollTop = node.scrollHeight; }, [entries, open, active]);
  if (!entries.length) return null;
  return <TraceCollapsible className="run-row run-thought" open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger className="focus-visible:ring-0">
      <TraceLine>
        <TraceIcon className="text-muted-foreground"><Brain/></TraceIcon>
        <TraceTitle className="font-medium text-foreground">{active ? 'Thinking…' : 'Thought'}</TraceTitle>
      </TraceLine>
    </TraceCollapsibleTrigger>
    {active && !open && latest && <p className="run-thought-preview">{latest}</p>}
    <TraceCollapsibleContent>
      <div className="run-thought-text" ref={follow}>
        {entries.map(entry => entry.kind === 'steps'
          ? <div key={entry.key} className="run-thought-steps" role="separator" aria-label={entry.labels.join(', ')}><span>{entry.labels.join(' · ')}</span><Separator className="flex-1"/></div>
          : <p key={entry.key} className={entry.kind === 'note' ? 'run-thought-note' : undefined}>{entry.text.replace(/\*\*/g, '').trim()}</p>)}
      </div>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}
