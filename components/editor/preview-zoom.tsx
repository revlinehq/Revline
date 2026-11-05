'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { ChevronDown, Hand, Minus, Plus, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PREVIEW_ZOOM_PRESETS, PREVIEW_ZOOM_STEP, PREVIEW_ZOOM_MIN, PREVIEW_ZOOM_MAX, fitPreviewView, normalizePreviewWheel, panPreviewBy, previewViewGeometry, zoomPreviewAt, type PreviewPoint, type PreviewSize, type PreviewView, type PreviewViewportSize } from '@/lib/editor/preview-zoom';
import './preview-zoom.css';

type ZoomContext = {
  canvas: PreviewSize;
  viewport: PreviewViewportSize;
  viewportRef: RefObject<HTMLDivElement | null>;
  attachViewport: (element: HTMLDivElement | null) => void;
  view: PreviewView;
  geometry: ReturnType<typeof previewViewGeometry>;
  handMode: boolean;
  setHandMode: (value: boolean) => void;
  safeGuides: boolean;
  setSafeGuides: (value: boolean) => void;
  getView: () => PreviewView;
  commit: (view: PreviewView) => void;
  fit: () => void;
  zoom: (factor: number) => void;
  preset: (percent: number) => void;
};
const PreviewZoomContext = createContext<ZoomContext | null>(null);

function usePreviewZoom() {
  const value = useContext(PreviewZoomContext);
  if (!value) throw new Error('Preview zoom needs its viewport provider.');
  return value;
}

// OpenCut's viewport center/fit model, adapted for our retained HyperFrames player.
// MIT attribution: NOTICE.
export function PreviewZoomProvider({ canvas, children }: { canvas: PreviewSize; children: ReactNode }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(null);
  const attachViewport = useCallback((element: HTMLDivElement | null) => { viewportRef.current = element; setViewportElement(element); }, []);
  const [viewport, setViewport] = useState<PreviewViewportSize>({ width: 0, height: 0, padding: 18 });
  const [view, setView] = useState(() => fitPreviewView(canvas));
  const viewRef = useRef(view);
  const [handMode, setHandMode] = useState(false);
  const [safeGuides, setSafeGuides] = useState(false);
  const commit = useCallback((next: PreviewView) => { viewRef.current = next; setView(next); }, []);
  const getView = useCallback(() => viewRef.current, []);
  const geometry = previewViewGeometry(view, canvas, viewport);
  const latest = useRef({ canvas, viewport, geometry });
  latest.current = { canvas, viewport, geometry };

  const fit = useCallback(() => { commit(fitPreviewView(latest.current.canvas)); setHandMode(false); }, [commit]);
  const zoom = useCallback((factor: number) => {
    const { canvas, viewport } = latest.current;
    const current = previewViewGeometry(viewRef.current, canvas, viewport);
    commit(zoomPreviewAt(viewRef.current, canvas, viewport, current.scale * factor, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [commit]);
  const preset = useCallback((percent: number) => {
    const { canvas, viewport } = latest.current;
    commit(zoomPreviewAt(viewRef.current, canvas, viewport, percent / 100, { x: viewport.width / 2, y: viewport.height / 2 }));
  }, [commit]);

  useEffect(() => { fit(); }, [canvas.width, canvas.height, fit]);
  useEffect(() => { if (!geometry.canPan) setHandMode(false); }, [geometry.canPan]);
  useEffect(() => {
    const element = viewportElement;
    if (!element) return;
    const measure = () => {
      const padding = Number.parseFloat(getComputedStyle(element).getPropertyValue('--preview-viewport-padding')) || 18;
      const next = { width: element.clientWidth, height: element.clientHeight, padding };
      setViewport(previous => previous.width === next.width && previous.height === next.height && previous.padding === next.padding ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewportElement]);

  useEffect(() => {
    const element = viewportElement;
    if (!element) return;
    let frame = 0, zoomDelta = 0, panX = 0, panY = 0;
    let anchor: PreviewPoint | undefined;
    const flush = () => {
      frame = 0;
      const { canvas, viewport } = latest.current;
      let next = viewRef.current;
      if (zoomDelta && anchor) {
        const current = previewViewGeometry(next, canvas, viewport);
        const cappedDelta = Math.max(-60, Math.min(60, zoomDelta));
        next = zoomPreviewAt(next, canvas, viewport, current.scale * Math.exp(-cappedDelta / 300), anchor);
      }
      if (panX || panY) next = panPreviewBy(next, canvas, viewport, { x: -panX, y: -panY });
      zoomDelta = panX = panY = 0;
      commit(next);
    };
    const wheel = (event: WheelEvent) => {
      const { viewport, geometry } = latest.current;
      const x = normalizePreviewWheel(event.deltaX, event.deltaMode, viewport.width);
      const y = normalizePreviewWheel(event.deltaY, event.deltaMode, viewport.height);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const rect = element.getBoundingClientRect();
        anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        zoomDelta += y;
      } else if (geometry.canPan && (x || y)) {
        event.preventDefault(); panX += x; panY += y;
      } else return;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    element.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => { element.removeEventListener('wheel', wheel, { capture: true }); if (frame) cancelAnimationFrame(frame); };
  }, [commit, viewportElement]);

  const value = useMemo(() => ({ canvas, viewport, viewportRef, attachViewport, view, geometry, handMode: handMode && geometry.canPan, setHandMode, safeGuides, setSafeGuides, getView, commit, fit, zoom, preset }), [canvas.width, canvas.height, viewport, view, handMode, safeGuides, attachViewport, getView, commit, fit, zoom, preset]);
  return <PreviewZoomContext.Provider value={value}>{children}</PreviewZoomContext.Provider>;
}

export function PreviewZoomControls() {
  const { canvas, view, geometry, fit, zoom, preset, handMode, setHandMode, safeGuides, setSafeGuides } = usePreviewZoom();
  const label = view.scale === null ? 'Fit' : `${Math.round(geometry.scale * 100)}%`;
  return <div className="preview-zoom-controls" role="group" aria-label="Preview view controls">
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out preview" title="Zoom out preview" onClick={() => zoom(1 / PREVIEW_ZOOM_STEP)} disabled={geometry.scale <= PREVIEW_ZOOM_MIN + .000001}><Minus size={14}/></Button>
    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" className="preview-zoom-trigger" aria-label={`Preview zoom: ${label}`} title="Zoom preview · Ctrl or ⌘ + scroll"><span>{label}</span><ChevronDown size={11}/></Button></DropdownMenuTrigger>
      <DropdownMenuContent className="preview-zoom-menu" align="start"><DropdownMenuRadioGroup value={view.scale === null ? 'fit' : String(Math.round(geometry.scale * 100))} onValueChange={value => value === 'fit' ? fit() : preset(Number(value))}>
        <DropdownMenuRadioItem value="fit">Fit to preview</DropdownMenuRadioItem><DropdownMenuSeparator/>
        {PREVIEW_ZOOM_PRESETS.map(percent => <DropdownMenuRadioItem key={percent} value={String(percent)}>{percent}%</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup></DropdownMenuContent>
    </DropdownMenu>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in preview" title="Zoom in preview" onClick={() => zoom(PREVIEW_ZOOM_STEP)} disabled={geometry.scale >= PREVIEW_ZOOM_MAX - .000001}><Plus size={14}/></Button>
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Pan preview" title="Pan preview · drag with the hand tool or middle mouse button" aria-pressed={handMode} disabled={!geometry.canPan} onClick={() => setHandMode(!handMode)}><Hand size={14}/></Button>
    {canvas.height>canvas.width&&<Button type="button" variant="ghost" size="icon-sm" aria-label={safeGuides?'Hide safe guides':'Show safe guides'} title="Vertical safe guides · keep important text inside. Platform layouts vary." aria-pressed={safeGuides} onClick={()=>setSafeGuides(!safeGuides)}><ScanLine size={14}/></Button>}
  </div>;
}

type PanSession = { pointer: number; start: PreviewPoint; view: PreviewView };
type PinchSession = { distance: number; midpoint: PreviewPoint; view: PreviewView };

function aspectUnit(canvas: PreviewSize) {
  let a = canvas.width, b = canvas.height;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  return { width: canvas.width / a, height: canvas.height / a };
}

export function PreviewViewport({ children }: { children: ReactNode }) {
  const { canvas, viewport, viewportRef, attachViewport, geometry, handMode, setHandMode, safeGuides, getView, commit, fit, zoom } = usePreviewZoom();
  // HyperFrames fits against integer offsetWidth/offsetHeight. An integer layout
  // with the exact project ratio prevents a fractional letterbox before zooming.
  const unit = aspectUnit(canvas);
  const multiples = Math.max(1, Math.floor(Math.min(geometry.layoutWidth / unit.width, geometry.layoutHeight / unit.height)));
  const layoutWidth = unit.width * multiples, layoutHeight = unit.height * multiples;
  // Place the scaled frame on whole device pixels of the screen, in the exact
  // project ratio. The viewport itself can sit at a fractional position, and a
  // fractional edge blends the frame background into the picture as a thin line.
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const element = viewportRef.current; if (!element) return;
    const measure = () => { const rect = element.getBoundingClientRect(); setOrigin(previous => previous.x === rect.x && previous.y === rect.y ? previous : { x: rect.x, y: rect.y }); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element); window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [viewportRef, viewport.width, viewport.height]);
  const snap = (value: number, offset: number) => Math.round((offset + value) * dpr) / dpr - offset;
  const units = Math.max(1, Math.floor(geometry.width * dpr / unit.width + 1e-6));
  const frameWidth = units * unit.width / dpr, frameHeight = units * unit.height / dpr;
  const frameLeft = snap(geometry.left + (geometry.width - frameWidth) / 2, origin.x), frameTop = snap(geometry.top + (geometry.height - frameHeight) / 2, origin.y);
  const sceneScale = frameWidth / layoutWidth;
  const pan = useRef<PanSession | null>(null);
  const pinch = useRef<PinchSession | null>(null);
  const touches = useRef(new Map<number, PreviewPoint>());
  const [panning, setPanning] = useState(false);
  const suppressClickUntil = useRef(0);
  const localPoint = (event: React.PointerEvent) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  function touchGeometry() {
    const [first, second] = [...touches.current.values()];
    if (!first || !second) return null;
    return { distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)), midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 } };
  }
  function endGesture(event: React.PointerEvent) {
    const active = pinch.current !== null || pan.current?.pointer === event.pointerId;
    touches.current.delete(event.pointerId);
    if (!active) return;
    event.preventDefault(); event.stopPropagation();
    pinch.current = null; pan.current = null; setPanning(false);
    suppressClickUntil.current = performance.now() + 300;
    const element = event.currentTarget;
    for (const id of [event.pointerId, ...touches.current.keys()]) if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    touches.current.clear();
  }

  return <div ref={attachViewport} className="preview-viewport" role="region" aria-label="Video preview viewport" tabIndex={0} data-pan-mode={handMode || undefined} data-panning={panning || undefined} data-preview-scale={geometry.scale} onPointerDownCapture={event => {
    if (event.pointerType === 'touch') {
      touches.current.set(event.pointerId, localPoint(event));
      const pair = touchGeometry();
      if (pair) {
        event.preventDefault(); event.stopPropagation();
        // Capturing the first touch cancels any single-finger layer drag before pinch starts.
        pinch.current = { ...pair, view: getView() }; pan.current = null;
        for (const id of touches.current.keys()) event.currentTarget.setPointerCapture(id);
        setPanning(true); return;
      }
    }
    const cropping = (event.target as HTMLElement).closest('.source-crop-view');
    if (geometry.canPan && (event.button === 1 || (event.button === 0 && handMode && !cropping))) {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true });
      pan.current = { pointer: event.pointerId, start: localPoint(event), view: getView() };
      event.currentTarget.setPointerCapture(event.pointerId); setPanning(true);
    } else if (event.target === event.currentTarget) event.currentTarget.focus({ preventScroll: true });
  }} onPointerMoveCapture={event => {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, localPoint(event));
    const pair = touchGeometry();
    if (pinch.current && pair) {
      event.preventDefault(); event.stopPropagation();
      const initial = pinch.current;
      const scale = previewViewGeometry(initial.view, canvas, viewport).scale * pair.distance / initial.distance;
      commit(zoomPreviewAt(initial.view, canvas, viewport, scale, initial.midpoint, pair.midpoint)); return;
    }
    const gesture = pan.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const point = localPoint(event);
    commit(panPreviewBy(gesture.view, canvas, viewport, { x: point.x - gesture.start.x, y: point.y - gesture.start.y }));
  }} onPointerUpCapture={endGesture} onPointerCancelCapture={endGesture} onLostPointerCapture={event => { if (event.target === event.currentTarget && (pinch.current || pan.current)) endGesture(event); }} onClickCapture={event => { if (performance.now() < suppressClickUntil.current) { event.preventDefault(); event.stopPropagation(); } }} onKeyDown={event => {
    if (event.target !== event.currentTarget) return;
    if (event.key === '+' || event.key === '=') { event.preventDefault(); event.stopPropagation(); zoom(PREVIEW_ZOOM_STEP); }
    else if (event.key === '-') { event.preventDefault(); event.stopPropagation(); zoom(1 / PREVIEW_ZOOM_STEP); }
    else if (event.key === '0') { event.preventDefault(); event.stopPropagation(); fit(); }
    else if (event.key.toLowerCase() === 'h' && geometry.canPan) { event.preventDefault(); event.stopPropagation(); setHandMode(!handMode); }
    else if (event.key === 'Escape' && handMode) { event.preventDefault(); event.stopPropagation(); setHandMode(false); }
    else if (geometry.canPan && event.key.startsWith('Arrow')) {
      const distance = event.shiftKey ? 100 : 30;
      const delta = { x: event.key === 'ArrowLeft' ? distance : event.key === 'ArrowRight' ? -distance : 0, y: event.key === 'ArrowUp' ? distance : event.key === 'ArrowDown' ? -distance : 0 };
      event.preventDefault(); event.stopPropagation(); commit(panPreviewBy(getView(), canvas, viewport, delta));
    }
  }}>
    <div className="preview-viewport-frame" style={{ width: frameWidth, height: frameHeight, left: frameLeft, top: frameTop, visibility: viewport.width && viewport.height ? 'visible' : 'hidden' }}>
      <div className="preview-viewport-scene" style={{ width: layoutWidth, height: layoutHeight, transform: `scale(${sceneScale})`, '--preview-view-scale': sceneScale } as CSSProperties}>{children}</div>
      {safeGuides&&canvas.height>canvas.width&&<div className="preview-safe-guides" aria-hidden="true"><div className="preview-safe-area"><span>Keep important text inside</span></div></div>}
    </div>
  </div>;
}

/** Places content just above and below the rendered preview frame (fitted, zoomed or panned), clamped inside the viewport. */
export function PreviewFrameOverlay({ above, below }: { above?: ReactNode; below?: ReactNode }) {
  const { canvas, geometry, view, viewport, viewportRef } = usePreviewZoom();
  // Controls above the frame stay where the fitted frame sits; zooming or
  // panning the picture must not carry them around the stage.
  const fitted = useRef<{ left: number; top: number; width: number; height: number } | null>(null);
  const [frame, setFrame] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    // The frame snaps to whole aspect units, so measure it rather than recomputing its size.
    const element = viewportRef.current, node = element?.querySelector<HTMLElement>('.preview-viewport-frame');
    if (!element || !node) { setFrame(null); return; }
    const outer = element.getBoundingClientRect(), rect = node.getBoundingClientRect();
    setFrame(previous => previous && previous.left === rect.left - outer.left && previous.top === rect.top - outer.top && previous.right === rect.right - outer.left && previous.bottom === rect.bottom - outer.top ? previous : { left: rect.left - outer.left, top: rect.top - outer.top, right: rect.right - outer.left, bottom: rect.bottom - outer.top });
  }, [viewportRef, geometry.left, geometry.top, geometry.width, geometry.height, viewport.width, viewport.height]);
  if (!frame) return null;
  const left = Math.max(0, frame.left), right = Math.min(viewport.width, frame.right);
  if (view.scale === null) fitted.current = { left: frame.left, top: frame.top, width: viewport.width, height: viewport.height };
  const fit = fitted.current?.width === viewport.width && fitted.current.height === viewport.height ? fitted.current : (() => {
    const base = previewViewGeometry(fitPreviewView(canvas), canvas, viewport);
    return { left: base.left, top: base.top };
  })();
  return <>
    {above && <div className="preview-frame-above" style={{ left: Math.max(0, fit.left), top: Math.max(0, fit.top - 32) }}>{above}</div>}
    {below && <div className="preview-frame-below" style={{ left, top: Math.min(viewport.height - 16, frame.bottom + 6), width: Math.max(0, right - left) }}>{below}</div>}
  </>;
}
