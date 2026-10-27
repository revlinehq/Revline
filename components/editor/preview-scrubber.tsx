'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import './preview-scrubber.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

/** A scrub bar under the preview for when the timeline is collapsed: click or drag to move the
 * playhead, arrow keys step one frame (Shift: one second). */
export function PreviewScrubber({ time, duration, fps, onSeek, controls, playing = false, readTime }: { time: number; duration: number; fps: number; onSeek: (time: number) => void; controls?: ReactNode; playing?: boolean; readTime?: () => number }) {
  const bar = useRef<HTMLDivElement>(null), frame = useRef(0);
  // Held keys repeat faster than the playhead re-renders; step from the last requested time.
  const pending = useRef<{ from: number; to: number } | null>(null);
  if (pending.current && pending.current.from !== time) pending.current = null;
  const fill = useRef<HTMLSpanElement>(null), thumb = useRef<HTMLSpanElement>(null);
  const progress = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
  // While playing the editor does not re-render every frame; follow the live clock directly.
  useEffect(() => {
    if (!playing || !readTime || duration <= 0) return;
    let raf = 0;
    const tick = () => {
      const at = `${Math.min(1, Math.max(0, readTime() / duration)) * 100}%`;
      if (fill.current) fill.current.style.width = at;
      if (thumb.current) thumb.current.style.left = at;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [playing, readTime, duration]);
  const seekAt = (clientX: number) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect?.width) return;
    const target = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => onSeek(target));
  };
  return <div className="preview-scrubber">
    {controls && <div className="preview-scrubber-controls">{controls}</div>}
    <div ref={bar} className="preview-scrubber-bar" role="slider" tabIndex={0} aria-label="Playhead" aria-valuemin={0} aria-valuemax={Math.round(duration * 100) / 100} aria-valuenow={Math.round(time * 100) / 100} aria-valuetext={`${clock(time)} of ${clock(duration)}`}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); seekAt(event.clientX); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event.clientX); }}
      onKeyDown={event => {
        const step = event.shiftKey ? 1 : 1 / fps;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); event.stopPropagation();
          const target = Math.min(duration, Math.max(0, (pending.current?.to ?? time) + (event.key === 'ArrowRight' ? step : -step)));
          pending.current = { from: time, to: target }; onSeek(target);
        }
      }}>
      <span ref={fill} className="preview-scrubber-fill" style={{ width: `${progress * 100}%` }} />
      <span ref={thumb} className="preview-scrubber-thumb" style={{ left: `${progress * 100}%` }} />
    </div>
    {!controls && <span className="preview-scrubber-time">{clock(time)} / {clock(duration)}</span>}
  </div>;
}
