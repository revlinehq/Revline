'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { aiRunChanges, aiStepLabel, aiStepRange } from '@/lib/editor/ai-activity';
import { equalTimelineValue } from '@/lib/editor/timeline-equality';
import type { Timeline } from '@/lib/editor/types';

/** How long change chips stay after a run ends. */
const LINGER_MS = 4000;
const MAX_STEPS = 4;

export type AiActivity = ReturnType<typeof useAiActivity>;

/** Tracks one AI run on the timeline: the range it is working in now, what it changed, and its steps. */
export function useAiActivity(timeline: Timeline, working: boolean) {
  const base = useRef<Timeline | null>(null), last = useRef<Timeline>(timeline);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [lingering, setLingering] = useState(false);
  useEffect(() => {
    if (working) {
      if (!base.current) { base.current = last.current; setSteps([]); setRange(null); }
      setLingering(false);
      return;
    }
    if (!base.current) return;
    // Keep the chips briefly so the result reads, then clear.
    setLingering(true); setRange(null);
    const timer = setTimeout(() => { base.current = null; setLingering(false); setSteps([]); }, LINGER_MS);
    return () => clearTimeout(timer);
  }, [working]);
  useEffect(() => {
    const previous = last.current; last.current = timeline;
    if (!working || !base.current || equalTimelineValue(previous.clips, timeline.clips)) return;
    const span = aiStepRange(previous, timeline);
    if (span) setRange(span);
    const label = aiStepLabel(previous, timeline);
    setSteps(current => current[current.length - 1] === label ? current : [...current, label].slice(-MAX_STEPS));
  }, [timeline, working]);
  const active = working || lingering;
  const changes = useMemo(() => active && base.current ? aiRunChanges(base.current, timeline) : null, [active, timeline]);
  return { working, active, range: working ? range : null, steps, changes: changes?.changes ?? new Map(), removed: changes?.removed ?? [] };
}
