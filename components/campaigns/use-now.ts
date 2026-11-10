'use client';

import { useEffect, useState } from 'react';

/** The current time, refreshed each minute so "5 min ago" and NEW stay true on an open page. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  return now;
}
