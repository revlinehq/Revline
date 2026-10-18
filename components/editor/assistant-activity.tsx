'use client';

import { useEffect, useState } from 'react';
import { Check, CircleAlert, CircleStop } from 'lucide-react';
import type { ProcessingState } from './processing-status';
import './processing-status.css';
import './assistant-activity.css';

function Elapsed({ startedAt }: { startedAt?: number | null }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = startedAt ?? Date.now();
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <small className="assistant-activity-elapsed" aria-hidden="true">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</small>;
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
  return <div className={`assistant-activity processing-status ${className}`} data-state={state} data-phase={phase} role={state === 'error' ? 'alert' : 'status'}>
    <div className="assistant-activity-heading">
      {Icon && <span className="assistant-activity-symbol" aria-hidden="true"><Icon size={15} strokeWidth={1.6}/></span>}
      <span className="processing-status-label">{title}</span>
      {state === 'working' && <Elapsed key={phase} startedAt={startedAt}/>}
    </div>
    {detail && <span className="processing-status-detail">{detail}</span>}
  </div>;
}
