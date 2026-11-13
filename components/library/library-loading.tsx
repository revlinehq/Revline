'use client';

import { useEffect, useState } from 'react';
import './library.css';

/** Data that arrives sooner than this shows with nothing in between. */
const QUIET_MS = 300;

/** True once `waiting` has lasted longer than QUIET_MS; false again as soon as it ends. */
export function useSlowWait(waiting: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), QUIET_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return waiting && slow;
}

/** The one placeholder the Library shows while it waits, and only after a moment: quick loads show nothing. */
export function LibraryLoading() {
  return useSlowWait(true) ? <p className="library-loading" role="status">Loading…</p> : null;
}

/** The Library page before it is loaded: an empty page, then the one quiet placeholder. */
export function LibraryPageLoading() {
  return <main className="dash-content library-page" aria-busy="true"><div className="library-body"><LibraryLoading /></div></main>;
}
