'use client';

import './media-tab.css';

/** Pull tab on the stage's right edge: a wide chevron that opens the media panel and, once open, closes it. */
export function MediaTab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const label = open ? 'Close media' : 'Open media';
  return <button type="button" className="media-tab" data-open={open || undefined} aria-label={label} aria-expanded={open} title={label} onClick={onToggle}>
    <svg className="media-tab-shape" viewBox="0 0 30 116" aria-hidden="true"><path d="M30 0c0 5.523-5.523 10-10 10l-10 0c-5.523 0-10 4.477-10 10l0 76c0 5.523 4.477 10 10 10l10 0c5.523 0 10 4.477 10 10z"/></svg>
    <svg className="media-tab-arrow" viewBox="0 0 10 28" aria-hidden="true"><path d="M8 2 2 14l6 12"/></svg>
  </button>;
}
