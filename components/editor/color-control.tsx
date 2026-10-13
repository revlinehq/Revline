'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

function pickerColor(value: string): string {
  if (/^#[\da-f]{3,4}$/i.test(value)) return `#${value.slice(1, 4).split('').map(char => char + char).join('')}`.toLowerCase();
  return /^#[\da-f]{6}([\da-f]{2})?$/i.test(value) ? value.slice(0, 7).toLowerCase() : '#ffffff';
}

/** Let the native picker own its draft. Only its accepted change edits the project. */
export function ColorControl({ label, value, onCommit }: { label: string; value: string; onCommit: (color: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const accepted = useRef(pickerColor(value));
  const latest = useRef(onCommit);
  useLayoutEffect(() => { latest.current = onCommit; });
  useEffect(() => {
    accepted.current = pickerColor(value);
    if (input.current && document.activeElement !== input.current) input.current.value = accepted.current;
  }, [value]);
  useEffect(() => {
    const node = input.current!;
    const commit = () => {
      const color = node.value;
      if (color === accepted.current) return;
      accepted.current = color;
      latest.current(color);
    };
    // React onChange also receives every native input event while dragging the wheel.
    node.addEventListener('change', commit);
    return () => node.removeEventListener('change', commit);
  }, []);
  return <input ref={input} aria-label={label} type="color" defaultValue={accepted.current} onBlur={event => { event.currentTarget.value = accepted.current; }}/>;
}
