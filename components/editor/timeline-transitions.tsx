'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { addTransitionClip, deleteClip, patchClip } from '@/lib/editor/operations';
import { EFFECT_CATALOG } from '@/lib/editor/clip-effects';
import { boundedTransitionRange, transitionDurationLimit, TRANSITION_PRESETS, isTransitionPreset, type TransitionPreset } from '@/lib/editor/clip-transitions';
import { EFFECT_DRAG_TYPE, readEffectDrag } from '@/lib/editor/effect-drag';
import type { Clip, Timeline } from '@/lib/editor/types';
import { EffectIcon } from './effect-icon';
import './timeline-transitions.css';

export function TimelineCutTransition({ timeline, from, to, clip, px, origin, selected, readOnly, onSelect, onEdit, onChange, onError }: {
  timeline: Timeline; from: Clip; to: Clip; clip?: Clip; px: number; origin: number; selected: boolean; readOnly?: boolean;
  onSelect: (id: string | null) => void; onEdit?: (id: string) => void; onChange: (timeline: Timeline) => void; onError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState<{ start: number; duration: number } | null>(null);
  const cancelGesture = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelGesture.current?.(), [clip, from, to]);
  const cut = to.start;
  const compact = Math.min(from.duration, to.duration) * px < 48;
  const range = draft ?? clip;
  const label = clip ? EFFECT_CATALOG[clip.effectPreset as TransitionPreset].label : 'Add transition';
  function apply(preset: TransitionPreset) {
    try {
      const id = clip?.id ?? crypto.randomUUID();
      if (clip?.effectPreset !== preset) onChange(clip ? patchClip(timeline, id, { effectPreset: preset }) : addTransitionClip(timeline, id, preset, from.id, to.id));
      onSelect(id); onEdit?.(id);
    } catch (error) { onError(error); }
  }
  function resize(event: React.PointerEvent<HTMLButtonElement>, side: 'left' | 'right') {
    if (!clip || readOnly || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); cancelGesture.current?.(); onSelect(clip.id);
    const handle = event.currentTarget, initial = event.clientX, initialEdge = side === 'left' ? clip.start : clip.start + clip.duration;
    let duration = clip.duration;
    const maximum = transitionDurationLimit(timeline, clip);
    const update = (clientX: number) => {
      duration = Math.min(maximum, Math.max(2 / timeline.fps, Math.round(2 * Math.abs(cut - (initialEdge + (clientX - initial) / px)) * timeline.fps) / timeline.fps));
      // Crossing the cut should stop at the minimum, never reverse the drag.
      if (side === 'left' ? initialEdge + (clientX - initial) / px >= cut : initialEdge + (clientX - initial) / px <= cut) duration = 2 / timeline.fps;
      setDraft(boundedTransitionRange(timeline, from, to, duration, clip.id));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', escape, true); window.removeEventListener('blur', cancel);
      cancelGesture.current = null; setDraft(null);
    };
    const move = (e: PointerEvent) => { if (e.pointerId === event.pointerId) update(e.clientX); };
    const finish = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      update(e.clientX); cleanup();
      if (duration !== clip.duration) try { onChange(patchClip(timeline, clip.id, { duration })); } catch (error) { onError(error); }
    };
    const cancel = () => cleanup();
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cancel(); } };
    handle.focus({ preventScroll: true }); cancelGesture.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel); window.addEventListener('keydown', escape, true); window.addEventListener('blur', cancel);
  }
  function resizeKey(event: React.KeyboardEvent<HTMLButtonElement>, side: 'left' | 'right') {
    if (!clip || readOnly || !['ArrowLeft', 'ArrowRight'].includes(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault(); event.stopPropagation();
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * (side === 'left' ? -1 : 1) * 2 * (event.shiftKey ? 10 : 1) / timeline.fps;
    try { onChange(patchClip(timeline, clip.id, { duration: Math.min(transitionDurationLimit(timeline, clip), Math.max(2 / timeline.fps, clip.duration + delta)) })); } catch (error) { onError(error); }
  }
  return <div className={`timeline-cut-transition${compact ? ' is-compact' : ''}${clip ? ' has-transition' : ''}${selected ? ' selected' : ''}${draft ? ' resizing' : ''}`} data-clip-id={clip?.id} data-transition-cut={cut} style={{ left: origin + cut * px }} onPointerDown={event => { event.stopPropagation(); if (clip && event.button === 0) onSelect(clip.id); }} onDragOver={event => { if (!readOnly && event.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; } }} onDrop={event => {
    if (readOnly) return;
    const effect = readEffectDrag(event.dataTransfer.getData(EFFECT_DRAG_TYPE));
    if (effect && 'preset' in effect && isTransitionPreset(effect.preset)) { event.preventDefault(); event.stopPropagation(); apply(effect.preset); }
  }}>
    {range && <div className="timeline-transition-range" style={{ left: (range.start - cut) * px, width: range.duration * px }}>
      {!readOnly && (['left', 'right'] as const).map(side => <button key={side} type="button" className={`timeline-transition-handle ${side}`} aria-label={`Resize ${label} ${side === 'left' ? 'start' : 'end'}`} title="Drag to change duration; arrow keys adjust by frame" onPointerDown={event => resize(event, side)} onKeyDown={event => resizeKey(event, side)}/>)}
      <output className="timeline-transition-duration">{range.duration.toFixed(2)} s</output>
    </div>}
    <DropdownMenu><DropdownMenuTrigger className="timeline-transition-badge" disabled={readOnly} aria-label={clip ? `${label} at ${cut.toFixed(2)}s` : `Add transition at ${cut.toFixed(2)}s`} title={clip ? `${label} · ${clip.duration.toFixed(2)} s · Click to replace, right-click for actions` : 'Add a transition between these clips'} onClick={() => { if (clip) { onSelect(clip.id); onEdit?.(clip.id); } }}>
      {clip ? <EffectIcon name={clip.effectPreset as TransitionPreset} size={14}/> : <Plus size={12}/>}
    </DropdownMenuTrigger><DropdownMenuContent className="timeline-transition-menu" align="center" aria-label="Choose transition" onPointerDown={event => event.stopPropagation()}>
      {TRANSITION_PRESETS.map(preset => <DropdownMenuItem key={preset} onSelect={() => apply(preset)}><EffectIcon name={preset} size={14}/>{EFFECT_CATALOG[preset].label}</DropdownMenuItem>)}
      {clip && <><DropdownMenuItem onSelect={() => { onSelect(clip.id); onEdit?.(clip.id); }}><SlidersHorizontal size={14}/>Transition settings</DropdownMenuItem><DropdownMenuItem onSelect={() => { onChange(deleteClip(timeline, clip.id)); onSelect(null); }}><Trash2 size={14}/>Remove transition</DropdownMenuItem></>}
    </DropdownMenuContent></DropdownMenu>
  </div>;
}
