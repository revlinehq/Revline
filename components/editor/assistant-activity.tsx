'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, CircleStop } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Trace, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';
import { cn } from '@/lib/utils';
import { minutesSeconds } from './minutes-seconds';

/** Elapsed run time is a development diagnostic; users see only the activity. */
const SHOW_ELAPSED = process.env.NODE_ENV === 'development';

function Elapsed({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <span aria-hidden="true">{minutesSeconds(seconds)}</span>;
}

/** The one line a working run shows: what is happening now, in plain words. It changes in place. */
export function AssistantActivity({ label, detail, startedAt, className = '' }: { label: string; detail?: string | null; startedAt?: number | null; className?: string }) {
  const phase = /^Queued/i.test(label) ? 'queued'
    : /^(Listening|Finding the rhythm)/i.test(label) ? 'listening'
    : /^(Watching|Analyzing footage|Inspecting the moment|Finding shot changes)/i.test(label) ? 'watching'
    : /^Applying edits/i.test(label) ? 'applying' : 'working';
  const title = phase === 'watching' ? 'Watching footage' : phase === 'listening' ? 'Listening to audio' : phase === 'queued' ? 'Queued' : label;
  return <Trace className={cn('assistant-activity', className)} data-phase={phase} role="status">
    <TraceLine>
      <TraceIcon><Spinner /></TraceIcon>
      <TraceTitle>{title}</TraceTitle>
      {detail && <TraceDescription className="min-w-0 shrink truncate">{detail}</TraceDescription>}
      {SHOW_ELAPSED && startedAt != null && <TraceDescription><Elapsed startedAt={startedAt}/></TraceDescription>}
    </TraceLine>
  </Trace>;
}

/** One line for a run that failed or was stopped: the reason, and at most one action. */
export function AssistantNotice({ state, children, action, className = '' }: { state: 'error' | 'stopped'; children: ReactNode; action?: ReactNode; className?: string }) {
  const Icon = state === 'error' ? CircleAlert : CircleStop;
  return <div className={cn('assistant-notice', className)} data-state={state} role={state === 'error' ? 'alert' : 'status'}>
    <Icon aria-hidden="true"/><span>{children}</span>{action}
  </div>;
}
