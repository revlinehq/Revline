import { Brand } from '@/components/workspace/brand';
import './processing-status.css';

export type ProcessingState = 'working' | 'ready' | 'error' | 'stopped';

/** A single compact activity row; percentages are supplied by the actual task. */
export function ProcessingStatus({ label, detail, progress, state = 'working', brand = true, className = '' }: {
  label: string; detail?: string | null; progress?: number | null; state?: ProcessingState; brand?: boolean; className?: string;
}) {
  const measured = typeof progress === 'number' && Number.isFinite(progress);
  return <div className={`processing-status ${className}`} data-state={state} role={state === 'error' ? 'alert' : 'status'}>
    {brand && <Brand markOnly />}
    <div className="processing-status-copy">
      <span className="processing-status-label">{label}</span>
      {detail && <span className="processing-status-detail">{detail}</span>}
      {state === 'working' && (measured
        ? <div className="processing-status-measured"><progress aria-label={label} max={100} value={Math.max(0, Math.min(100, progress))}/><span>{Math.round(Math.max(0, Math.min(100, progress)))}%</span></div>
        : <span className="processing-status-sweep" aria-hidden="true" />)}
    </div>
  </div>;
}

export function processingDetail(activity?: string | null, source?: string | null) {
  if (source) return source;
  if (activity?.startsWith('Queued')) return 'Your task is next in line.';
  if (activity?.startsWith('Retrying')) return 'Reconnecting to the media service.';
  if (activity?.startsWith('Listening')) return 'Preparing words and their timestamps.';
  if (activity?.startsWith('Analyzing')) return 'Looking for moments that match your request.';
  if (activity?.startsWith('Finding the rhythm')) return 'Listening for hits in your chosen audio.';
  if (activity?.startsWith('Following')) return 'Keeping the chosen subject in frame.';
  return undefined;
}
