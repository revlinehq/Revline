'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser, LoaderCircle, Pencil, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { userError } from '@/lib/user-error';
import './preview-sketch.css';

/** Development builds only: sketching on the preview to show the editing agent what to change. */
export const PREVIEW_SKETCH_ENABLED = process.env.NODE_ENV === 'development';

const COLORS = [{ id: 'red', label: 'Red', value: '#ff3b30' }, { id: 'white', label: 'White', value: '#ffffff' }, { id: 'yellow', label: 'Yellow', value: '#ffd60a' }] as const;
type SketchColor = typeof COLORS[number]['id'];
/** Points are in project pixels, so strokes stay on the frame at any preview zoom. */
type Stroke = { color: string; width: number; points: [number, number][] };
type Size = { width: number; height: number };

/** 12.4 seconds reads as 0:12.4. */
export function sketchTime(seconds: number) {
  const tenths = Math.max(0, Math.round(seconds * 10)), minutes = Math.floor(tenths / 600), rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

function strokePath(points: [number, number][]) {
  if (points.length === 1) { const [x, y] = points[0]; return `M${x} ${y}L${x + .01} ${y}`; }
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
}

export type PreviewSketch = ReturnType<typeof usePreviewSketch>;

/** State shared by the toolbar controls and the drawing layer over the frame. */
export function usePreviewSketch({ canvas, onStart, capture, readTime, onSend }: {
  canvas: Size;
  /** Called when sketching turns on and when a stroke begins (pauses playback). */
  onStart: () => void;
  /** The rendered composition at project resolution. */
  capture: () => HTMLElement | null;
  readTime: () => number;
  onSend: (file: File, prompt: string) => Promise<void>;
}) {
  const [active, setActive] = useState(false);
  const [color, setColor] = useState<SketchColor>('red');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef({ onStart, capture, readTime, onSend, canvas });
  latest.current = { onStart, capture, readTime, onSend, canvas };

  const toggle = useCallback((next?: boolean) => setActive(previous => {
    const value = next ?? !previous;
    if (value && !previous) latest.current.onStart();
    if (!value) setError('');
    return value;
  }), []);
  useEffect(() => {
    if (!active) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); toggle(false); } };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [active, toggle]);

  const send = useCallback(async () => {
    if (sending || !strokes.length) return;
    setSending(true); setError('');
    try {
      const { canvas, capture, readTime, onSend } = latest.current;
      const time = readTime(), frame = capture();
      if (!frame) throw new Error('The preview frame is not ready yet.');
      const { domToCanvas } = await import('modern-screenshot');
      const picture = await domToCanvas(frame, { width: canvas.width, height: canvas.height, scale: 1, backgroundColor: '#000000', style: { transform: 'none' } });
      const output = document.createElement('canvas');
      output.width = canvas.width; output.height = canvas.height;
      const context = output.getContext('2d');
      if (!context) throw new Error('Could not draw the sketch.');
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      context.lineCap = 'round'; context.lineJoin = 'round';
      for (const stroke of strokes) { context.strokeStyle = stroke.color; context.lineWidth = stroke.width; context.stroke(new Path2D(strokePath(stroke.points))); }
      const blob = await new Promise<Blob | null>(resolve => output.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not save the sketch.');
      const label = sketchTime(time);
      await onSend(new File([blob], `Sketch at ${label.replace(':', 'm')}s.png`, { type: 'image/png' }), `Sketch at ${label}`);
      setStrokes([]); setActive(false);
    } catch (e) { setError(userError(e, 'Could not send the sketch.')); }
    finally { setSending(false); }
  }, [sending, strokes]);

  return {
    active, toggle, color, setColor, strokes, sending, error, send,
    stroke: COLORS.find(item => item.id === color)!.value,
    add: (stroke: Stroke) => setStrokes(previous => [...previous, stroke]),
    undo: () => setStrokes(previous => previous.slice(0, -1)),
    clear: () => setStrokes([]),
    begin: () => latest.current.onStart(),
  };
}

/** The pencil toggle, and while sketching its colours, undo, clear and send. */
export function PreviewSketchControls({ sketch, disabled }: { sketch: PreviewSketch; disabled?: boolean }) {
  return <div className="preview-sketch-controls" role="group" aria-label="Sketch on preview">
    <Button type="button" variant="ghost" size="icon-sm" aria-label={sketch.active ? 'Stop sketching' : 'Sketch on preview'} title={sketch.active ? 'Stop sketching · Esc' : 'Sketch on preview'} aria-pressed={sketch.active} disabled={disabled && !sketch.active} onClick={() => sketch.toggle()}><Pencil size={14}/></Button>
    {sketch.active && <>
      <ToggleGroup type="single" spacing={0} aria-label="Pencil colour" value={sketch.color} onValueChange={next => { if (next) sketch.setColor(next as SketchColor); }}>
        {COLORS.map(item => <ToggleGroupItem key={item.id} value={item.id} size="sm" className="preview-sketch-swatch" aria-label={item.label} title={item.label}><span style={{ background: item.value }}/></ToggleGroupItem>)}
      </ToggleGroup>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Undo last stroke" title="Undo last stroke" disabled={!sketch.strokes.length || sketch.sending} onClick={sketch.undo}><Undo2 size={14}/></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear sketch" title="Clear sketch" disabled={!sketch.strokes.length || sketch.sending} onClick={sketch.clear}><Eraser size={14}/></Button>
      <Button type="button" variant="secondary" size="sm" className="preview-sketch-send" disabled={!sketch.strokes.length || sketch.sending} onClick={() => void sketch.send()}>{sketch.sending ? <LoaderCircle size={13} className="animate-spin"/> : <Send size={13}/>}<span>Send to chat</span></Button>
      {sketch.error && <span className="preview-sketch-error" role="alert">{sketch.error}</span>}
    </>}
  </div>;
}

/** A transparent drawing surface exactly over the rendered frame, in project pixels. */
export function PreviewSketchLayer({ sketch, canvas }: { sketch: PreviewSketch; canvas: Size }) {
  const surface = useRef<SVGSVGElement>(null);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const pointer = useRef<number | null>(null);
  if (!sketch.active) return null;
  const point = (event: React.PointerEvent): [number, number] => {
    const rect = surface.current!.getBoundingClientRect();
    return [(event.clientX - rect.left) / rect.width * canvas.width, (event.clientY - rect.top) / rect.height * canvas.height];
  };
  const end = (event: React.PointerEvent) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (current) sketch.add(current);
    setCurrent(null);
  };
  const width = Math.max(4, Math.round(Math.min(canvas.width, canvas.height) * .008));
  return <svg ref={surface} className="preview-sketch-layer" viewBox={`0 0 ${canvas.width} ${canvas.height}`} preserveAspectRatio="none" aria-label="Sketch layer" role="img"
    onPointerDown={event => {
      if (event.button !== 0 || pointer.current !== null || sketch.sending) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointer.current = event.pointerId; sketch.begin();
      setCurrent({ color: sketch.stroke, width, points: [point(event)] });
    }}
    onPointerMove={event => {
      if (pointer.current !== event.pointerId) return;
      event.preventDefault();
      const next = point(event);
      setCurrent(previous => previous ? { ...previous, points: [...previous.points, next] } : previous);
    }}
    onPointerUp={end} onPointerCancel={end} onClick={event => event.stopPropagation()}>
    {[...sketch.strokes, ...(current ? [current] : [])].map((stroke, index) => <path key={index} d={strokePath(stroke.points)} stroke={stroke.color} strokeWidth={stroke.width} fill="none" strokeLinecap="round" strokeLinejoin="round"/>)}
  </svg>;
}
