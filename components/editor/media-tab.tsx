'use client';

import './media-tab.css';

/** Pull tab on the stage's right edge while the side panel is closed; opens it on Media. */
export function MediaTab({ onOpen }: { onOpen: () => void }) {
  return <button type="button" className="media-tab" aria-label="Open media" title="Open media" onClick={onOpen}>
    <svg className="media-tab-shape" viewBox="0 0 30 116" aria-hidden="true"><path d="M30 0c0 5.523-5.523 10-10 10l-10 0c-5.523 0-10 4.477-10 10l0 76c0 5.523 4.477 10 10 10l10 0c5.523 0 10 4.477 10 10z"/></svg>
    <span className="media-tab-grip" aria-hidden="true"/>
    <span className="media-tab-label">Media</span>
  </button>;
}
