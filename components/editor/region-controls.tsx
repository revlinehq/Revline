'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { DEFAULT_BLUR_REGION_STRENGTH, MAX_BLUR_REGIONS, dragRegionRect, frameRectToSource, normalizeBlurRegion, sourceRectToFrame, type RegionHandle } from '@/lib/editor/blur-regions';
import type { BlurRegion, Clip } from '@/lib/editor/types';
import './region-controls.css';

type Rect = { x: number; y: number; width: number; height: number };
type Gesture = { pointer: number; target: HTMLElement; handle: RegionHandle | 'draw'; index: number | null; x: number; y: number; width: number; height: number; initial: Rect };
const handles = [['nw', 'top left'], ['n', 'top'], ['ne', 'top right'], ['w', 'left'], ['e', 'right'], ['sw', 'bottom left'], ['s', 'bottom'], ['se', 'bottom right']] as const;
const MIN_DRAWN = .01;

/**
 * Blur regions drawn on the live preview: each region outlined where it shows on the output frame, dragged
 * to move, its handles to resize; dragging on empty picture draws a new one. The preview underneath shows the
 * real blur once a gesture is saved. Rectangles are stored in source-frame fractions (lib/editor/blur-regions.ts).
 */
export function RegionControls({ clip, source, canvas, selected, onSelect, onCommit, onExit }: {
  clip: Clip; source: { width: number; height: number }; canvas: { width: number; height: number };
  selected: number | null; onSelect: (index: number | null) => void;
  onCommit: (regions: BlurRegion[] | undefined, select: number | null) => void; onExit: () => void;
}) {
  const root = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null);
  const [draft, setDraft] = useState<{ index: number | null; rect: Rect } | null>(null);
  const regions = clip.blurRegions ?? [];
  const latest = useRef({ clip, regions, selected, onSelect, onCommit, onExit }); latest.current = { clip, regions, selected, onSelect, onCommit, onExit };
  const frameOf = (region: BlurRegion) => sourceRectToFrame(region, clip, source, canvas);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return;
      const { regions, selected, onCommit, onExit } = latest.current;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (gesture.current) cancel(); else onExit(); return; }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected !== null && regions[selected]) {
        event.preventDefault(); event.stopImmediatePropagation();
        const rest = regions.filter((_, index) => index !== selected);
        onCommit(rest.length ? rest : undefined, null);
      }
    };
    window.addEventListener('keydown', keys, true);
    return () => window.removeEventListener('keydown', keys, true);
  }, []);

  function release() {
    const active = gesture.current;
    gesture.current = null;
    if (active?.target.hasPointerCapture(active.pointer)) active.target.releasePointerCapture(active.pointer);
    return active;
  }
  function cancel() { release(); setDraft(null); }
  function start(event: PointerEvent<HTMLElement>, handle: RegionHandle | 'draw', index: number | null) {
    if (event.button !== 0) return;
    const bounds = root.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return;
    if (handle === 'draw' && regions.length >= MAX_BLUR_REGIONS) { onSelect(null); return; }
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
    const initial = handle === 'draw' ? { ...point, width: 0, height: 0 } : frameOf(regions[index!]);
    gesture.current = { pointer: event.pointerId, target: event.currentTarget, handle, index, x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height, initial };
    if (index !== null) onSelect(index);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const dx = (event.clientX - active.x) / active.width, dy = (event.clientY - active.y) / active.height;
    if (active.handle === 'draw') {
      const clamp = (value: number) => Math.min(1, Math.max(0, value));
      const ax = active.initial.x, ay = active.initial.y, bx = clamp(ax + dx), by = clamp(ay + dy);
      setDraft({ index: null, rect: { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) } });
    } else setDraft({ index: active.index, rect: dragRegionRect(active.initial, active.handle, dx, dy) });
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    event.stopPropagation();
    const active = release(), shown = draft;
    setDraft(null);
    if (!active || !shown) return;
    if (active.handle === 'draw' && (shown.rect.width < MIN_DRAWN || shown.rect.height < MIN_DRAWN)) return;
    let rect: Rect;
    try { rect = frameRectToSource(shown.rect, clip, source, canvas); } catch { return; }
    if (active.handle === 'draw') {
      const template = selected !== null ? regions[selected] : regions.at(-1);
      const region = normalizeBlurRegion({ ...rect, mode: template?.mode ?? 'blur', strength: template?.strength ?? DEFAULT_BLUR_REGION_STRENGTH });
      onCommit([...regions, region], regions.length);
    } else {
      const previous = regions[active.index!];
      onCommit(regions.map((region, index) => index === active.index ? normalizeBlurRegion({ ...previous, ...rect }) : region), active.index);
    }
  }

  return <div ref={root} className="region-controls" data-testid="region-controls" aria-label="Draw blur regions on the preview" onPointerDown={event => start(event, 'draw', null)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel} onLostPointerCapture={end}>
    {regions.map((region, index) => {
      const rect = draft?.index === index ? draft.rect : frameOf(region), active = index === selected;
      return <div key={index} className="region-box" data-selected={active || undefined} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}>
        <Button type="button" variant="ghost" className="region-body" aria-label={`Move region ${index + 1}`} onPointerDown={event => start(event, 'move', index)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}/>
        <span className="region-tag" aria-hidden="true">{index + 1}</span>
        {active && handles.map(([handle, label]) => <Button key={handle} type="button" variant="ghost" className={`region-handle region-handle-${handle}`} aria-label={`Resize region ${index + 1} ${label}`} onPointerDown={event => start(event, handle, index)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}><span/></Button>)}
      </div>;
    })}
    {draft?.index === null && <div className="region-box region-draft" style={{ left: `${draft.rect.x * 100}%`, top: `${draft.rect.y * 100}%`, width: `${draft.rect.width * 100}%`, height: `${draft.rect.height * 100}%` }}/>}
  </div>;
}
