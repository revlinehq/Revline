'use client';

import { useEffect, useState } from 'react';
import { SLOW_START_MS } from '@/lib/media-analysis/activity';

/** True once `waiting` has stayed true for longer than a sleeping worker normally takes to start. */
export function useSlowStart(waiting: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), SLOW_START_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return waiting && slow;
}
