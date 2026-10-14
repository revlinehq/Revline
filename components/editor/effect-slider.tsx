'use client';

import { useEffect, useId, useRef, useState } from 'react';
import './effect-slider.css';

const rangeKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function EffectSlider({ label, value, bounds, step = .01, format, disabled, onPreview, onCommit }: {
  label: string; value: number; bounds: readonly [number, number]; step?: number; format: (value: number) => string; disabled: boolean;
  onPreview: (value: number | null) => void; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const gesture = useRef<{ initial: number; value: number } | null>(null);
  const frame = useRef(0);
  const callbacks = useRef({ onPreview, onCommit }); callbacks.current = { onPreview, onCommit };
  const id = useId();
  function cancel() {
    if (!gesture.current) return;
    cancelAnimationFrame(frame.current); frame.current = 0;
    setDraft(gesture.current.initial); gesture.current = null;
    callbacks.current.onPreview(null);
  }
  function commit() {
    const current = gesture.current;
    if (!current) return;
    cancelAnimationFrame(frame.current); frame.current = 0; gesture.current = null;
    if (current.value === current.initial) callbacks.current.onPreview(null);
    else { callbacks.current.onPreview(current.value); callbacks.current.onCommit(current.value); }
  }
  useEffect(() => {
    if (gesture.current && (disabled || gesture.current.initial !== value)) cancel();
    if (!gesture.current) setDraft(value);
  }, [value, disabled]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (gesture.current) callbacks.current.onPreview(null);
  }, []);
  const progress = bounds[1] > bounds[0] ? Math.min(100, Math.max(0, (draft - bounds[0]) / (bounds[1] - bounds[0]) * 100)) : 0;
  return <div className="effect-slider" data-disabled={disabled || undefined}>
    <span className="effect-slider-fill" aria-hidden="true" style={{ width: `${progress}%` }}/>
    <span className="effect-slider-handle" aria-hidden="true" style={{ left: `clamp(0px, calc(${progress}% - 7px), calc(100% - 2px))` }}/>
    <div className="effect-slider-readout" aria-hidden="true"><span>{label}</span><output htmlFor={id}>{format(draft)}</output></div>
    <input id={id} type="range" aria-label={label} aria-valuetext={format(draft)} min={bounds[0]} max={bounds[1]} step={step} value={draft} disabled={disabled}
      onPointerDown={event => { if (event.button === 0) { gesture.current = { initial: value, value: draft }; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={commit} onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
        else if (rangeKeys.has(event.key)) { event.stopPropagation(); gesture.current ??= { initial: value, value: draft }; }
      }}
      onKeyUp={event => { if (rangeKeys.has(event.key)) { event.stopPropagation(); commit(); } }}
      onChange={event => {
        const next = Number(event.currentTarget.value); setDraft(next);
        if (!gesture.current) { callbacks.current.onCommit(next); return; }
        gesture.current.value = next;
        if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) callbacks.current.onPreview(gesture.current.value); });
      }}/>
  </div>;
}

