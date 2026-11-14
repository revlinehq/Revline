'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { ThoughtEntry } from './assistant-run';
import { minutesSeconds } from './minutes-seconds';

const seconds = (from: number) => Math.max(0, Math.floor((Date.now() - from) / 1000));
const spoken = (total: number) => total < 60 ? `${total}s` : `${Math.floor(total / 60)}m ${total % 60}s`;

function useElapsed(startedAt: number, running: boolean) {
  const [value, setValue] = useState(() => seconds(startedAt));
  useEffect(() => {
    setValue(seconds(startedAt));
    if (!running) return;
    const timer = setInterval(() => setValue(seconds(startedAt)), 1000);
    return () => clearInterval(timer);
  }, [startedAt, running]);
  return value;
}

/** The current turn's reasoning, in a shelf on top of the composer instead of the message list. Closed it is one live
 * line (what it is doing, how long it has been going); open it shows every thought, newest at the bottom. When the
 * turn ends it folds to how long it thought and stays until the next message. Mount it with the turn's key. */
export function ThinkingShelf({ entries, activity, active, startedAt }: { entries: ThoughtEntry[]; activity?: string; active: boolean; startedAt?: number | null }) {
  const [open, setOpen] = useState(false);
  // The run's own start when known; otherwise when this turn was first seen working.
  const [seenAt] = useState(() => Date.now());
  // Keep the run's start once known: it can clear on the same render that ends the run.
  const [known, setKnown] = useState(startedAt ?? null);
  if (startedAt != null && startedAt !== known) setKnown(startedAt);
  const start = known ?? seenAt;
  const elapsed = useElapsed(start, active);
  const [thoughtFor, setThoughtFor] = useState<number | null>(null);
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) setThoughtFor(seconds(start));
    wasActive.current = active;
  }, [active, start]);
  const paragraphs = entries.flatMap(entry => entry.kind === 'steps' ? [] : entry.text.replace(/[*`#]+/g, '').replace(/^\s*[-•]\s+/gm, '').split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map((text, index) => ({ key: `${entry.key}-${index}`, text })));
  const body = useRef<HTMLDivElement>(null);
  // Open while the run works, it stays on the newest paragraph.
  useEffect(() => { const node = body.current; if (node && open && active) node.scrollTop = node.scrollHeight; }, [paragraphs.length, entries, open, active]);
  if (!active && !paragraphs.length) return null;
  const Chevron = open ? ChevronDown : ChevronUp;
  return <Collapsible className="thinking-shelf" data-active={active || undefined} open={open && !!paragraphs.length} onOpenChange={setOpen}>
    <CollapsibleTrigger className="thinking-shelf-line" disabled={!paragraphs.length} aria-label={open ? 'Hide thinking' : 'Show thinking'}>
      {active ? <>
        <span className="thinking-shelf-dot" aria-hidden="true"/>
        <span className="thinking-shelf-title">Thinking</span>
        {activity && !open && <span className="thinking-shelf-activity">· {activity}</span>}
        <span className="thinking-shelf-time">{minutesSeconds(elapsed)}</span>
      </> : <span className="thinking-shelf-title">{thoughtFor !== null ? `Thought for ${spoken(thoughtFor)}` : 'Thought'}</span>}
      {!!paragraphs.length && <Chevron className="thinking-shelf-chevron" aria-hidden="true"/>}
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="thinking-shelf-body" ref={body}>
        {paragraphs.map(paragraph => <p key={paragraph.key}>{paragraph.text}</p>)}
      </div>
    </CollapsibleContent>
  </Collapsible>;
}
