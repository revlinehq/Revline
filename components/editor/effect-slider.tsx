'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import './effect-slider.css';

const rangeKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function EffectSlider({ label, ariaLabel, value, bounds, step = .01, format, disabled, onPreview, onCommit }: {
  label: string; ariaLabel?: string; value: number; bounds: readonly [number, number]; step?: number; format: (value: number) => string; disabled: boolean;
  onPreview: (value: number | null) => void; onCommit: (value: number) => void;
}) {
  const bounded = (next: number) => Math.min(bounds[1], Math.max(bounds[0], Number.isFinite(next) ? next : bounds[0]));
  const currentValue = bounded(value);
  const [draft, setDraft] = useState(currentValue);
  const displayed = bounded(draft);
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
    if (gesture.current && (disabled || gesture.current.initial !== currentValue || gesture.current.value !== bounded(gesture.current.value))) cancel();
    if (!gesture.current) setDraft(currentValue);
  }, [currentValue, disabled, bounds[0], bounds[1]]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (gesture.current) callbacks.current.onPreview(null);
  }, []);
  const progress = bounds[1] > bounds[0] ? Math.min(100, Math.max(0, (displayed - bounds[0]) / (bounds[1] - bounds[0]) * 100)) : 0;
  return <div className="effect-slider" data-disabled={disabled || undefined} style={{ '--slider-progress': `${progress}%` } as CSSProperties}>
    <span className="effect-slider-fill" aria-hidden="true" style={{ width: `${progress}%` }}/>
    <span className="effect-slider-handle" aria-hidden="true" style={{ left: `clamp(0px, calc(${progress}% - 7px), calc(100% - 2px))` }}/>
    <div className="effect-slider-readout" aria-hidden="true"><span>{label}</span><output htmlFor={id}>{format(displayed)}</output></div>
    <input id={id} type="range" aria-label={ariaLabel ?? label} aria-valuetext={format(displayed)} min={bounds[0]} max={bounds[1]} step={step} value={displayed} disabled={disabled}
      onPointerDown={event => { if (event.button === 0) { gesture.current = { initial: currentValue, value: displayed }; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={commit} onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
        else if (rangeKeys.has(event.key)) { event.stopPropagation(); gesture.current ??= { initial: currentValue, value: displayed }; }
      }}
      onKeyUp={event => { if (rangeKeys.has(event.key)) { event.stopPropagation(); commit(); } }}
      onChange={event => {
        if (!Number.isFinite(event.currentTarget.valueAsNumber)) return;
        const next = bounded(event.currentTarget.valueAsNumber); setDraft(next);
        if (!gesture.current) { callbacks.current.onCommit(next); return; }
        gesture.current.value = next;
        if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) callbacks.current.onPreview(gesture.current.value); });
      }}/>
  </div>;
}
