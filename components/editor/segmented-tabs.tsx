'use client';

import './segmented-tabs.css';
import type { ReactNode } from 'react';

type Segment<Value extends string> = { value: Value; label: string; id: string; panelId: string; icon?: ReactNode };

/** Shared option navigation for the inspector and its tool library. */
export function SegmentedTabs<Value extends string>({ label, options, value, onChange, className = '' }: {
  label: string;
  options: readonly [Segment<Value>, Segment<Value>, ...Segment<Value>[]];
  value: Value;
  onChange: (value: Value) => void;
  className?: string;
}) {
  return <div className={`segmented-tabs ${className}`} style={{gridTemplateColumns:`repeat(${options.length},minmax(0,1fr))`}} role="tablist" aria-label={label} onKeyDown={event => {
    if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
    const current = options.findIndex(option => option.value === value);
    const index = event.key === 'ArrowRight' ? (current + 1) % options.length : event.key === 'ArrowLeft' ? (current + options.length - 1) % options.length : event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : undefined;
    if (index === undefined) return;
    event.preventDefault();
    onChange(options[index].value);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
  }}>{options.map(option => <button key={option.value} type="button" role="tab" id={option.id} data-segment={option.value} data-library-tab={option.value} aria-controls={option.panelId} aria-selected={value === option.value} tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)}>{option.icon}{option.label}</button>)}</div>;
}
