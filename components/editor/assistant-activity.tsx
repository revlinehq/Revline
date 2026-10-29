'use client';

import { useEffect, useState } from 'react';
import { Check, CircleAlert, CircleStop } from 'lucide-react';
import type { ProcessingState } from './processing-status';
import { Spinner } from '@/components/ui/spinner';
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { cn } from '@/lib/utils';

/** Elapsed run time is a development diagnostic; users see only the activity. */
const SHOW_ELAPSED = process.env.NODE_ENV === 'development';

function Elapsed({ startedAt }: { startedAt?: number | null }) {
  const [seconds, setSeconds] = useState(0);
  // Without a run start, count from first render; phase changes must not restart it.
  const [mountedAt] = useState(() => Date.now());
  useEffect(() => {
    const start = startedAt ?? mountedAt;
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt, mountedAt]);
  return <span aria-hidden="true">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>;
}

export function AssistantActivity({ label, detail, state = 'working', startedAt, className = '' }: {
  label: string; detail?: string | null; state?: ProcessingState; startedAt?: number | null; className?: string;
}) {
  const phase = state !== 'working' ? state
    : /^Queued/i.test(label) ? 'queued'
    : /^(Listening|Finding the rhythm)/i.test(label) ? 'listening'
    : /^(Watching|Analyzing footage|Inspecting the moment|Finding shot changes)/i.test(label) ? 'watching'
    : /^Applying edits/i.test(label) ? 'applying' : 'working';
  const title = phase === 'watching' ? 'Watching footage' : phase === 'listening' ? 'Listening to audio' : phase === 'queued' ? 'Queued' : label;
  const Icon = state === 'ready' ? Check : state === 'stopped' ? CircleStop : state === 'error' ? CircleAlert : null;
  // One shadcn Trace line: a spinner and shimmering title while working, an icon for finished states.
  return <Trace className={cn('assistant-activity', className)} data-state={state} data-phase={phase} role={state === 'error' ? 'alert' : 'status'}>
    <TraceLine status={state === 'working' ? 'running' : state === 'error' ? 'error' : undefined}>
      <TraceIcon>{Icon ? <Icon /> : <Spinner />}</TraceIcon>
      <TraceTitle className="font-medium">{title}</TraceTitle>
      {SHOW_ELAPSED && state === 'working' && <TraceDescription><Elapsed startedAt={startedAt}/></TraceDescription>}
    </TraceLine>
    {detail && <p className="pl-6 text-xs text-muted-foreground whitespace-pre-line line-clamp-3">{detail}</p>}
  </Trace>;
}
