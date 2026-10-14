'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { audioFadeGain, audioSettings, type AudioSettings } from '@/lib/editor/audio-settings';
import type { Clip } from '@/lib/editor/types';
import './audio-fade-handles.css';

type Side = 'fadeIn' | 'fadeOut';
type Gesture = { side: Side; initial: number; value: number; base: AudioSettings; clipKey: string } & ({ kind: 'keyboard' } | { kind: 'pointer'; pointer: number; target: HTMLButtonElement; x: number; width: number });
const keys = new Set(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End']);

export function AudioFadeHandles({ clip, fps, readOnly = false, onSelect, onPreview, onCommit }: { clip: Clip; fps: number; readOnly?: boolean; onSelect: () => void; onPreview?: (audio: AudioSettings | null) => void; onCommit: (audio: AudioSettings) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const callbacks = useRef({ onPreview, onCommit }); callbacks.current = { onPreview, onCommit };
  const [draft, setDraft] = useState<AudioSettings | null>(null);
  const saved = audioSettings(clip), settings = draft ?? saved;
  const clipKey = `${clip.id}:${clip.duration}:${JSON.stringify(clip.audio)}:${JSON.stringify(clip.audioFadeTiming)}`;
  const remaining = (side: Side, base: AudioSettings) => Math.max(0, clip.duration - base[side === 'fadeIn' ? 'fadeOut' : 'fadeIn']);
  const bounded = (side: Side, base: AudioSettings, value: number) => Math.max(0, Math.min(Math.floor((remaining(side, base) + 1e-7) * fps) / fps, Math.round(value * fps) / fps));
  const result = (current: Gesture): AudioSettings => ({ ...current.base, [current.side]: current.value });
  function paint(current: Gesture) {
    setDraft(result(current));
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) callbacks.current.onPreview?.(result(gesture.current)); });
  }
  function settle(cancel = false) {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null; cancelAnimationFrame(frame.current); frame.current = 0;
    if (cancel || Math.abs(current.initial - current.value) < 1e-7) callbacks.current.onPreview?.(null);
    else { callbacks.current.onPreview?.(result(current)); callbacks.current.onCommit(result(current)); }
    if (current.kind === 'pointer' && current.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer);
    setDraft(null);
  }
  useEffect(() => { if (gesture.current && (readOnly || gesture.current.clipKey !== clipKey)) settle(true); }, [clipKey, readOnly]);
  useEffect(() => {
    const cancel = () => settle(true);
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); cancel(); };
  }, []);
  function start(event: PointerEvent<HTMLButtonElement>, side: Side) {
    if (readOnly || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); settle(true); onSelect(); event.currentTarget.focus({ preventScroll: true });
    const width = root.current?.getBoundingClientRect().width;
    if (!width) return;
    gesture.current = { kind: 'pointer', side, initial: saved[side], value: saved[side], base: saved, clipKey, target: event.currentTarget, pointer: event.pointerId, x: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (current?.kind !== 'pointer' || current.pointer !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    current.value = bounded(current.side, current.base, current.initial + (event.clientX - current.x) / current.width * clip.duration * (current.side === 'fadeIn' ? 1 : -1)); paint(current);
  }
  function finishPointer(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    if (gesture.current?.kind !== 'pointer' || gesture.current.pointer !== event.pointerId) return;
    event.stopPropagation(); settle(cancel);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, side: Side) {
    if (readOnly) return;
    if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); settle(true); return; }
    if (!keys.has(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
    event.preventDefault(); event.stopPropagation();
    if (!gesture.current) { onSelect(); gesture.current = { kind: 'keyboard', side, initial: saved[side], value: saved[side], base: saved, clipKey }; }
    const current = gesture.current;
    if (current.kind !== 'keyboard' || current.side !== side) return;
    const delta = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 10 : 1) / fps;
    current.value = bounded(side, current.base, event.key === 'Home' ? 0 : event.key === 'End' ? remaining(side, current.base) : current.value + delta); paint(current);
  }
  const inPercent = clip.duration ? settings.fadeIn / clip.duration * 100 : 0, outPercent = clip.duration ? settings.fadeOut / clip.duration * 100 : 0;
  const display = { ...clip, audio: settings, audioFadeTiming: draft ? undefined : clip.audioFadeTiming };
  const points = Array.from({ length: 61 }, (_, index) => `${index / 60 * 100},${(1 - audioFadeGain(display, clip.duration * index / 60)) * 100}`).join(' ');
  return <div ref={root} className="audio-fade-handles" data-nearby={Math.abs(inPercent - (100-outPercent)) < 3.5 || undefined} data-fade-in={settings.fadeIn} data-fade-out={settings.fadeOut}>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline className="audio-fade-line" points={points} fill="none" vectorEffect="non-scaling-stroke"/></svg>
    {!readOnly && (['fadeIn','fadeOut'] as const).map(side => <button key={side} type="button" className={`audio-fade-handle ${side === 'fadeIn' ? 'fade-in' : 'fade-out'}`} style={{ left: `clamp(6px, ${side === 'fadeIn' ? inPercent : 100-outPercent}%, calc(100% - 6px))` }} role="slider" aria-label={`Audio fade ${side === 'fadeIn' ? 'in' : 'out'}`} aria-valuemin={0} aria-valuemax={remaining(side, settings)} aria-valuenow={settings[side]} aria-valuetext={`${Number(settings[side].toFixed(3))} seconds`} disabled={remaining(side, settings) <= 0} title={`Fade ${side === 'fadeIn' ? 'in' : 'out'}: ${Number(settings[side].toFixed(2))} s · Drag or use arrows; Shift moves ten frames`} onPointerDown={event => start(event, side)} onPointerMove={move} onPointerUp={event => finishPointer(event)} onPointerCancel={event => finishPointer(event, true)} onLostPointerCapture={event => finishPointer(event, true)} onKeyDown={event => keyboard(event, side)} onKeyUp={event => { if (keys.has(event.key) && gesture.current?.kind === 'keyboard') { event.stopPropagation(); settle(); } }} onBlur={() => { if (gesture.current?.kind === 'keyboard') settle(); }}/>) }
  </div>;
}
