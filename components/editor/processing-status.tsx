import { Brand } from '@/components/workspace/brand';
import './processing-status.css';

export type ProcessingState = 'working' | 'ready' | 'error' | 'stopped';

/** A single compact activity row; percentages are supplied by the actual task. */
export function ProcessingStatus({ label, detail, progress, state = 'working', brand = true, inlineBrand = false, className = '' }: {
  label: string; detail?: string | null; progress?: number | null; state?: ProcessingState; brand?: boolean; inlineBrand?: boolean; className?: string;
}) {
  const measured = typeof progress === 'number' && Number.isFinite(progress);
  return <div className={`processing-status ${className}`} data-state={state} role={state === 'error' ? 'alert' : 'status'}>
    {brand && !inlineBrand && <Brand markOnly />}
    <div className="processing-status-copy">
      {inlineBrand ? <span className="processing-status-heading">{brand && <Brand markOnly />}<span className={`processing-status-label${state === 'working' ? ' shimmer' : ''}`}>{label}</span></span> : <span className={`processing-status-label${state === 'working' ? ' shimmer' : ''}`}>{label}</span>}
      {detail && <span className="processing-status-detail">{detail}</span>}
      {state === 'working' && (measured
        ? <div className="processing-status-measured"><progress aria-label={label} max={100} value={Math.max(0, Math.min(100, progress))}/><span>{Math.round(Math.max(0, Math.min(100, progress)))}%</span></div>
        : <span className="processing-status-sweep" aria-hidden="true" />)}
    </div>
  </div>;
}
