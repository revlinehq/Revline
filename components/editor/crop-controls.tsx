'use client';

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { calculateVisualRect } from '@/lib/editor/visual-source-geometry';
import { cropSelectionRect, dragSourceCrop, sameSourceCrop, type CropHandle } from '@/lib/editor/source-crop';
import { DEFAULT_CROP, type SourceCrop } from '@/lib/editor/types';
import './visual-controls.css';

export type CropControlsHandle = { reset(): void; done(): void; cancel(): void };
type SourceFrame = HTMLImageElement | HTMLVideoElement;
type CropGesture = { pointer: number; target: HTMLElement; handle: CropHandle; x: number; y: number; width: number; height: number; initial: SourceCrop };
const handles = [
  ['nw', 'top left', 'nwse-resize'], ['n', 'top', 'ns-resize'], ['ne', 'top right', 'nesw-resize'],
  ['w', 'left', 'ew-resize'], ['e', 'right', 'ew-resize'],
  ['sw', 'bottom left', 'nesw-resize'], ['s', 'bottom', 'ns-resize'], ['se', 'bottom right', 'nwse-resize'],
] as const;

export const CropControls = forwardRef<CropControlsHandle, {
  initial?: SourceCrop;
  sourceSize: { width: number; height: number };
  canvas: { width: number; height: number };
  getSource: () => SourceFrame | null;
  revision: number;
  onCommit: (crop: SourceCrop) => void;
  onCancel: () => void;
}>(function CropControls({ initial = DEFAULT_CROP, sourceSize, canvas, getSource, revision, onCommit, onCancel }, ref) {
  const image = useRef<HTMLCanvasElement>(null), bounds = useRef<HTMLDivElement>(null), gesture = useRef<CropGesture | null>(null);
  const [draft, setDraft] = useState<SourceCrop>(() => ({ ...initial }));
  const draftRef = useRef(draft);
  const [painted, setPainted] = useState(false);
  const latest = useRef({ initial, onCommit, onCancel, getSource });
  latest.current = { initial, onCommit, onCancel, getSource };
  const source = calculateVisualRect(sourceSize.width, sourceSize.height, canvas.width, canvas.height, DEFAULT_CROP, undefined, 'contain').window;
  const selection = cropSelectionRect(draft, { left: 0, top: 0, width: 1, height: 1 });
  const selectionStyle = { left: `${selection.left * 100}%`, top: `${selection.top * 100}%`, width: `${selection.width * 100}%`, height: `${selection.height * 100}%` } as CSSProperties;
  function update(crop: SourceCrop) { draftRef.current = crop; setDraft(crop); }
  function release(cancel = false) {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (cancel) update(active.initial);
    if (active.target.hasPointerCapture(active.pointer)) active.target.releasePointerCapture(active.pointer);
  }
  function finish(cancel: boolean) {
    release(cancel);
    if (cancel || sameSourceCrop(latest.current.initial, draftRef.current)) latest.current.onCancel();
    else latest.current.onCommit(draftRef.current);
  }
  useImperativeHandle(ref, () => ({ reset: () => { release(); update({ ...DEFAULT_CROP }); }, done: () => finish(false), cancel: () => finish(true) }), []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation(); finish(true);
    };
    window.addEventListener('keydown', cancel, true);
    return () => { window.removeEventListener('keydown', cancel, true); release(); };
  }, []);
  useLayoutEffect(() => {
    const frame = latest.current.getSource(), target = image.current;
    if (!frame || !target) return;
    const scale = Math.min(1, 2048 / Math.max(sourceSize.width, sourceSize.height));
    target.width = Math.round(sourceSize.width * scale); target.height = Math.round(sourceSize.height * scale);
    const draw = () => {
      const available = frame.tagName === 'VIDEO' ? (frame as HTMLVideoElement).readyState >= 2 : (frame as HTMLImageElement).complete && (frame as HTMLImageElement).naturalWidth > 0;
      if (!available) return;
      try { target.getContext('2d')?.drawImage(frame, 0, 0, target.width, target.height); setPainted(true); } catch { /* The loaded/seeked event retries a frame still being decoded. */ }
    };
    // Read the decoded element directly; no extra request, video decoder, or pixel extraction.
    draw(); const tick = requestAnimationFrame(draw);
    for (const event of ['load', 'loadeddata', 'seeked']) frame.addEventListener(event, draw);
    return () => { cancelAnimationFrame(tick); for (const event of ['load', 'loadeddata', 'seeked']) frame.removeEventListener(event, draw); };
  }, [revision, sourceSize.width, sourceSize.height]);
  function start(event: PointerEvent<HTMLElement>, handle: CropHandle) {
    if (event.button !== 0 || !painted) return;
    const rect = bounds.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    // Large hit areas can overlap on a narrow crop. Use the closest visible
    // handle center instead of whichever later sibling wins hit testing.
    if (handle !== 'move') {
      let distance = Infinity;
      for (const candidate of bounds.current!.querySelectorAll<HTMLElement>('[data-crop-handle]')) {
        const hit = candidate.getBoundingClientRect();
        const next = Math.hypot(event.clientX-hit.left-hit.width/2,event.clientY-hit.top-hit.height/2);
        if (next < distance) { distance = next; handle = candidate.dataset.cropHandle as CropHandle; }
      }
    }
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointer: event.pointerId, target: event.currentTarget, handle, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, initial: draftRef.current };
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    update(dragSourceCrop(active.initial, active.handle, event.clientX - active.x, event.clientY - active.y, active.width, active.height));
  }
  function end(event: PointerEvent<HTMLElement>, cancel = false) {
    if (gesture.current?.pointer !== event.pointerId) return;
    event.stopPropagation(); release(cancel);
  }
  function keyboard(event: React.KeyboardEvent, handle: CropHandle) {
    const step = event.shiftKey ? 10 : 1;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!dx && !dy) return;
    event.preventDefault(); event.stopPropagation();
    const rect = bounds.current?.getBoundingClientRect();
    if (rect && painted) update(dragSourceCrop(draftRef.current, handle, dx, dy, rect.width, rect.height));
  }
  return <div className="source-crop-view" data-testid="source-crop-view" aria-label="Crop footage in preview">
    <div ref={bounds} className="source-crop-bounds" data-testid="source-crop-bounds" style={{ left: `${source.left / canvas.width * 100}%`, top: `${source.top / canvas.height * 100}%`, width: `${source.width / canvas.width * 100}%`, height: `${source.height / canvas.height * 100}%` }}>
      <canvas ref={image} className="source-crop-frame" aria-hidden="true"/>
      {painted && <><div className="source-crop-mask" aria-hidden="true"><div className="source-crop-shade" style={selectionStyle}/></div>
        <div className="source-crop-selection" role="button" tabIndex={0} aria-label="Move crop area. Use arrow keys to adjust." style={selectionStyle} onKeyDown={event => keyboard(event, 'move')} onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event)}/>
        {handles.map(([handle, label, cursor]) => <button key={handle} data-crop-handle={handle} type="button" className={`source-crop-handle ${handle.length === 1 ? 'source-crop-edge' : ''}`} aria-label={`Crop ${label}. Use arrow keys to adjust.`} style={{ left: `${(handle.includes('w') ? draft.left : handle.includes('e') ? 1 - draft.right : draft.left + selection.width / 2) * 100}%`, top: `${(handle.includes('n') ? draft.top : handle.includes('s') ? 1 - draft.bottom : draft.top + selection.height / 2) * 100}%`, cursor }} onKeyDown={event => keyboard(event, handle)} onPointerDown={event => start(event, handle)} onPointerMove={move} onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event)}><span/></button>)}
      </>}
    </div>
    {!painted && <span className="source-crop-loading" role="status">Preparing source frame…</span>}
  </div>;
});
