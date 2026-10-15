'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import './text-preset-picker.css';

export const TEXT_PREVIEW_FPS = 30;
export const TEXT_PREVIEW_DURATION = 90;
export const TEXT_PREVIEW_HOLD_FRAME = 45;

/** A hovered/focused card owns a clock and always uses the production frame renderer. */
export function TextPreviewCard({ label, selected, onSelect, render, className = '', previewFirst = false, autoPlay = false }: { label: string; selected?: boolean; onSelect?: () => void; render: (frame: number) => ReactNode; className?: string; previewFirst?: boolean; autoPlay?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [frame, setFrame] = useState(TEXT_PREVIEW_HOLD_FRAME);
  const [previewing, setPreviewing] = useState(false);
  const [replay, setReplay] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const automatic = autoPlay ? visible : !reducedMotion && (hovered || focused);
  const active = automatic || previewing;
  useEffect(() => {
    if (!autoPlay || !card.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .1 });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [autoPlay]);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!active) return;
    let request = 0;
    const started = performance.now();
    setFrame(0);
    const tick = (now: number) => {
      const elapsed = Math.floor((now - started) / 1000 * TEXT_PREVIEW_FPS);
      if (elapsed >= TEXT_PREVIEW_DURATION && !automatic) { setPreviewing(false); return; }
      setFrame(elapsed % TEXT_PREVIEW_DURATION); request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [active, replay, automatic]);
  const stage = render(active ? frame : TEXT_PREVIEW_HOLD_FRAME);
  if (previewFirst) return <div ref={card} className={`text-preset-card text-animation-card ${className}`} role="group" aria-label={label} data-selected={selected} onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => setHovered(false)} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <button type="button" className="text-preset-stage text-animation-preview" aria-label={`Preview ${label}`} title="Play preview" onClick={() => { setPreviewing(true); setReplay(value => value + 1); }}><span aria-hidden="true">{stage}</span></button>
    <span className="text-preset-label"><span>{label}</span><button type="button" className="text-animation-apply" aria-label={`Apply ${label}`} aria-pressed={!!selected} disabled={!onSelect} title={!onSelect ? 'Select a text clip to apply this animation.' : undefined} onClick={onSelect}>{selected ? <Check size={11} aria-hidden="true"/> : <Plus size={11} aria-hidden="true"/>}Apply</button></span>
  </div>;
  return <button type="button" className={`text-preset-card ${className}`} aria-label={label} aria-pressed={selected} aria-disabled={!onSelect} title={!onSelect ? 'Select a text clip to apply this animation.' : undefined} onClick={onSelect} onPointerEnter={event => { if (event.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
    <span className="text-preset-stage" aria-hidden="true">{stage}</span>
    <span className="text-preset-label"><span>{label}</span>{selected ? <Check size={12} aria-hidden="true"/> : <Plus size={12} aria-hidden="true"/>}</span>
  </button>;
}
