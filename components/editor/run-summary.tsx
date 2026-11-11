'use client';

import { Fragment, useState } from 'react';
import { AlertTriangle, Check, CircleCheck, CircleStop, Minus } from 'lucide-react';
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import type { TurnRun } from './assistant-run';
import { ChatProse } from './chat-prose';

type StepImage = { label: string; src: string };

/** What a step rendered (frames), small under the step; click for full size. */
function StepImages({ images }: { images: StepImage[] }) {
  const [open, setOpen] = useState<StepImage | null>(null);
  return <div className="run-summary-images">
    {images.map((image, index) => <button key={index} type="button" className="run-summary-image" onClick={() => setOpen(image)} aria-label={`Open ${image.label || 'image'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.src} alt={image.label}/>{image.label && <span>{image.label}</span>}
    </button>)}
    <Dialog open={!!open} onOpenChange={value => { if (!value) setOpen(null); }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <DialogContent className="run-summary-image-dialog"><DialogTitle>{open?.label || 'Image'}</DialogTitle>{open && <img src={open.src} alt={open.label}/>}</DialogContent>
    </Dialog>
  </div>;
}

/** A finished run as one collapsed line. Opened, it lists what was done in plain words, one line each,
 * with what the assistant said along the way and the model that ran. */
export function RunSummary({ run, failed = false, model, effort, modelLabel }: { run: TurnRun; /** The turn itself failed, not only a step the assistant recovered from. */ failed?: boolean; model?: string; effort?: string; modelLabel?: string }) {
  const [open, setOpen] = useState(false);
  if (!run.steps) return null;
  const count = `${run.steps} ${run.steps === 1 ? 'step' : 'steps'}`;
  const label = run.stopped ? `Stopped after ${count}` : run.readOnly ? 'Checked your project' : `Ran ${count}`;
  const Status = failed ? AlertTriangle : run.stopped ? CircleStop : CircleCheck;
  return <TraceCollapsible className="run-summary" open={open} onOpenChange={setOpen}>
    <TraceCollapsibleTrigger className="focus-visible:ring-0">
      <TraceLine>
        <TraceIcon className={failed ? 'text-[#c3853c]' : undefined}><Status/></TraceIcon>
        <TraceTitle>{label}</TraceTitle>
        {run.failed > 0 && <TraceDescription>{run.failed} failed</TraceDescription>}
      </TraceLine>
    </TraceCollapsibleTrigger>
    <TraceCollapsibleContent>
      <Trace aria-label="What the assistant did" className="gap-1.5">
        {run.lines.map(line => {
          if (line.state === 'note') return <div key={line.key} className="run-summary-note"><ChatProse text={line.text}/></div>;
          const Mark = line.state === 'error' ? AlertTriangle : line.state === 'done' ? Check : Minus;
          return <Fragment key={line.key}>
            <TraceLine className="text-xs" status={line.state === 'error' ? 'error' : line.state === 'done' ? undefined : 'pending'}>
              <TraceIcon><Mark className="size-3.5"/></TraceIcon>
              <TraceTitle>{line.text}</TraceTitle>
              {line.count > 1 && <TraceDescription>×{line.count}</TraceDescription>}
              {line.state === 'error' && <TraceDescription className="text-destructive/80">failed</TraceDescription>}
              {line.state !== 'error' && line.state !== 'done' && <TraceDescription>stopped</TraceDescription>}
            </TraceLine>
            {line.images.length > 0 && <StepImages images={line.images}/>}
          </Fragment>;
        })}
        {/* The model and effort the server recorded for this turn's run, not what the composer asked for. */}
        {modelLabel && <p className="run-summary-model" data-turn-model={model} data-turn-effort={effort}>{modelLabel}</p>}
      </Trace>
    </TraceCollapsibleContent>
  </TraceCollapsible>;
}
