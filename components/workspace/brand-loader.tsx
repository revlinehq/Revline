'use client';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { LOWER_FOLD, LOWER_FRAME, UPPER_FOLD, UPPER_FRAME } from './brand';

// A round brush runs along each fold's length; the mask reveals only the
// logo's exact shape, so every frame has a smooth leading edge.
const UPPER_SPINE = 'M7 45C36 39 66 27 97 11L90 84';
const LOWER_SPINE = 'M5 57C32 45 62 32 105 20';

function Fold({ id, frame, fold, spine, brush, gap }: { id: string; frame: typeof UPPER_FRAME; fold: string; spine: string; brush: number; gap: string }) {
  return <g className="revline-fold" transform={gap}><svg {...frame}>
    <mask id={id} maskUnits="userSpaceOnUse"><path className="revline-fold-brush" d={spine} pathLength={1} fill="none" stroke="#fff" strokeWidth={brush} strokeLinecap="round" strokeLinejoin="round"/></mask>
    <path className="revline-fold-fill" d={fold} mask={`url(#${id})`}/>
  </svg></g>;
}

/** Page and panel loading state: the Revline fold paints itself in, then loops. */
export function BrandLoader({ label, size = 40, className, announce = true }: { label?: string; size?: number; className?: string; announce?: boolean }) {
  const id = useId().replace(/:/g, '');
  const status = announce ? { role: 'status', 'aria-live': 'polite' as const, 'aria-label': label ? undefined : 'Loading' } : {};
  return <div className={cn('revline-loader', className)} {...status} style={{ '--revline-loader-size': `${size}px` } as React.CSSProperties}>
    <svg className="revline-loader-mark" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <Fold id={`${id}-upper`} frame={UPPER_FRAME} fold={UPPER_FOLD} spine={UPPER_SPINE} brush={66} gap="translate(0.32 -0.36)"/>
      <Fold id={`${id}-lower`} frame={LOWER_FRAME} fold={LOWER_FOLD} spine={LOWER_SPINE} brush={50} gap="translate(-0.32 0.36)"/>
    </svg>
    {label && <p>{label}</p>}
  </div>;
}
