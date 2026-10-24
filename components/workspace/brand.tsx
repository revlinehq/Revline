import { cn } from '@/lib/utils';

// Original Revline fold, using the exact paths from the Pen brand component.
const UPPER_FOLD = 'M80.29961 2.30981l-64.85001 27.64999c-19.025 8.7-20.025 23.60001-5.5 26.475 31.85001 6.32501 51.425 10.5 61.97501 14.6 9.375 3.675 15.27499 10.30001 17.24998 17.00001l-3.29999-17.22501c-0.60001-3.49999-0.27501-7.12499 1.025-10.4l17.925-44.775c4.09999-11.725-7.675-19.825-24.52499-13.32499z';
const LOWER_FOLD = 'M27.52819 18.775c-6.775 2.42499-12.325 6.45-14.65 11.4l-11.9 22.70001c-4.45 10.32498 6.95 15.02499 20.7 11.02499l72.225-23.52499c9.175-3.125 15.89999-9.15001 15.92499-17.12502 0.02501-10.12499-12.025-17.69999-27.49999-23.24999l-54.8 18.775z';

function Folds({ drawn = false }: { drawn?: boolean }) {
  const path = (d: string) => drawn ? <><path className="revline-fold-line" d={d} pathLength={1}/><path className="revline-fold-fill" d={d}/></> : <path d={d}/>;
  // The loader eases the folds apart so each reads as its own stroke.
  const upper = <svg x="4.20005" y="1.32132" width="13.80645" height="11.48387" viewBox="0 0 107 89">{path(UPPER_FOLD)}</svg>;
  const lower = <svg x="1.52862" y="10.44839" width="14.19355" height="8.51613" viewBox="0 0 110 66">{path(LOWER_FOLD)}</svg>;
  return drawn ? <><g transform="translate(0.32 -0.36)">{upper}</g><g transform="translate(-0.32 0.36)">{lower}</g></> : <>{upper}{lower}</>;
}

export function Brand({ markOnly = false, className }: { markOnly?: boolean; className?: string }) {
  return <span className={cn('revline-brand', className)}><svg className="revline-mark" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><Folds/></svg>{!markOnly && <span>revline</span>}</span>;
}

/** Page and panel loading state: the Revline fold traces itself, then fills. */
export function BrandLoader({ label, size = 40, className, announce = true }: { label?: string; size?: number; className?: string; announce?: boolean }) {
  const status = announce ? { role: 'status', 'aria-live': 'polite' as const, 'aria-label': label ? undefined : 'Loading' } : {};
  return <div className={cn('revline-loader', className)} {...status} style={{ '--revline-loader-size': `${size}px` } as React.CSSProperties}>
    <svg className="revline-loader-mark" viewBox="0 0 20 20" aria-hidden="true"><Folds drawn/></svg>
    {label && <p>{label}</p>}
  </div>;
}
