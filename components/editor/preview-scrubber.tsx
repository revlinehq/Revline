'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import './preview-scrubber.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/**
 * The scrub bar under the preview when the timeline is collapsed. A native range input: the browser
 * moves the thumb under the pointer at once, and seeks follow at most once per frame. During playback
 * it reads the live playhead every frame instead of waiting for the editor to re-render.
 * Arrow keys step one frame (Shift: one second).
 */
export function PreviewScrubber({ time, duration, fps, onSeek, controls, playing = false, readTime }: { time: number; duration: number; fps: number; onSeek: (time: number) => void; controls?: ReactNode; playing?: boolean; readTime?: () => number }) {
  const input = useRef<HTMLInputElement>(null), dragging = useRef(false), seekFrame = useRef(0), target = useRef<number | null>(null);
  const label = useRef<HTMLSpanElement>(null);
  const show = (seconds: number) => {
    const element = input.current; if (!element) return;
    element.value = String(seconds);
    element.style.setProperty('--progress', String(duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0));
    if (label.current) label.current.textContent = `${clock(seconds)} / ${clock(duration)}`;
  };
  // Paused and not dragging: follow the editor's playhead.
  useEffect(() => { if (!dragging.current && !playing) show(time); });
  // Playing: follow the live clock every frame.
  useEffect(() => {
    if (!playing || !readTime) return;
    let raf = 0;
    const tick = () => { if (!dragging.current) show(readTime()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, readTime, duration]);
  useEffect(() => () => cancelAnimationFrame(seekFrame.current), []);
  // Coalesce drag updates: only the latest position is sought, once per frame.
  const seek = (seconds: number) => {
    target.current = seconds;
    if (seekFrame.current) return;
    seekFrame.current = requestAnimationFrame(() => { seekFrame.current = 0; if (target.current !== null) onSeek(target.current); target.current = null; });
  };
  return <div className="preview-scrubber">
    {controls && <div className="preview-scrubber-controls">{controls}</div>}
    <input ref={input} type="range" className="preview-scrubber-range" aria-label="Playhead" min={0} max={duration} step={1 / fps} defaultValue={time}
      aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      onPointerDown={() => { dragging.current = true; }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
      onInput={event => { const seconds = Number(event.currentTarget.value); show(seconds); seek(seconds); }}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault(); event.stopPropagation();
        const step = event.shiftKey ? 1 : 1 / fps, current = Number(event.currentTarget.value);
        const next = Math.min(duration, Math.max(0, current + (event.key === 'ArrowRight' ? step : -step)));
        show(next); seek(next);
      }}/>
    {!controls && <span ref={label} className="preview-scrubber-time">{clock(time)} / {clock(duration)}</span>}
  </div>;
}
