'use client';

import { useEffect, useState } from 'react';
import { useAction, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { LoaderCircle, Upload } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { userError } from '@/lib/user-error';
import { formatBytes } from './format';
import { usePlanUsage } from '@/components/workspace/plan-usage';

type Summary = FunctionReturnType<typeof api.storage.summary>;
type Unfinished = FunctionReturnType<typeof api.cloudMedia.unfinished>[number];
const KINDS = [['videoBytes', 'Video'], ['audioBytes', 'Audio'], ['imageBytes', 'Images'], ['modelBytes', 'Models'], ['exportBytes', 'Exports']] as const;
/** Parts are up to 95 MB, so only a long silence suggests a closed tab rather than a slow link. */
const QUIET_MS = 30 * 60_000;
function elapsed(ms: number) { const minutes = Math.floor(ms / 60_000); if (minutes < 1) return 'under a minute'; if (minutes < 60) return `${minutes} min`; const hours = Math.floor(minutes / 60); return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`; }

/** The quiet meter beside the page name: what is stored against the plan's storage limit (convex/lib/plan_limits.ts
 * refuses uploads past it), split by kind. Without a limit (billing off) the bar splits what is used. */
export function LibraryUsage({ summary }: { summary?: Summary }) {
  const [review, setReview] = useState(false);
  const limit = usePlanUsage()?.storage.limitBytes ?? null;
  if (!summary?.ready) return <div className="library-usage" aria-busy="true"><Skeleton className="h-1 w-[84px]" /><Skeleton className="h-3 w-20" /></div>;
  const scale = limit ?? summary.usedBytes, used = limit === null ? `${formatBytes(summary.usedBytes)} used` : `${formatBytes(summary.usedBytes)} of ${formatBytes(limit)}`;
  return <>
    <Popover>
      <PopoverTrigger asChild><Button variant="ghost" className="library-usage" aria-label={`${used}. Show storage by kind`}>
        <span className="library-meter" aria-hidden="true">{KINDS.map(([field]) => <i key={field} data-kind={field} style={{ width: `${scale > 0 ? Math.min(100, summary[field] / scale * 100) : 0}%` }} />)}</span>
        <span>{used}</span>
      </Button></PopoverTrigger>
      <PopoverContent align="end" className="library-usage-panel">
        <strong>{used}</strong>
        {limit !== null && summary.usedBytes + summary.reservedBytes >= limit && <p>Your storage is full. Delete files or upgrade your plan to upload more. Nothing stored is removed.</p>}
        <ul>{KINDS.map(([field, label]) => <li key={field}><i data-kind={field} />{label}<span>{formatBytes(summary[field])}</span></li>)}</ul>
        {summary.reservedBytes > 0 && <p>{formatBytes(summary.reservedBytes)} reserved for uploads in progress. <Button variant="soft" size="sm" onClick={() => setReview(true)}>Review</Button></p>}
      </PopoverContent>
    </Popover>
    {review && <UnfinishedUploads onClose={() => setReview(false)} />}
  </>;
}

function UnfinishedUploads({ onClose }: { onClose: () => void }) {
  const uploads = useQuery(api.cloudMedia.unfinished, {}), abort = useAction(api.cloudMedia.abort);
  const [cancelling, setCancelling] = useState<ReadonlySet<string>>(() => new Set()), [error, setError] = useState(''), [now] = useState(() => Date.now());
  const count = uploads?.length ?? 0;
  // Close once nothing is left.
  useEffect(() => { if (uploads && !uploads.length) onClose(); }, [uploads, onClose]);
  async function cancel(items: Unfinished[]) {
    const ids = items.map(item => item.uploadId).filter(id => !cancelling.has(id)); if (!ids.length) return;
    setError(''); setCancelling(current => new Set([...current, ...ids]));
    const results = await Promise.allSettled(ids.map(uploadId => abort({ uploadId })));
    setCancelling(current => { const next = new Set(current); for (const id of ids) next.delete(id); return next; });
    const failed = results.find(result => result.status === 'rejected');
    if (failed) setError(userError(failed.reason, 'Could not cancel every upload. Please retry.'));
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="library-dialog library-move-dialog" showCloseButton={false}>
    <DialogTitle>Unfinished uploads</DialogTitle>
    <DialogDescription>Uploads that stop sending data are cleared automatically after 2 hours. Choose the same file again before then to continue where it stopped, or cancel them now to free their space. Cancelling an upload still running in another tab stops it.</DialogDescription>
    <ul className="library-unfinished">{uploads?.map(upload => { const quiet = now - upload.activeAt >= QUIET_MS, busy = cancelling.has(upload.uploadId); return <li key={upload.uploadId}>
      <Upload aria-hidden="true" />
      <div><strong title={upload.fileName}>{upload.fileName}</strong><small>{formatBytes(upload.size)} · started {elapsed(now - upload.createdAt)} ago · {quiet ? `no new data for ${elapsed(now - upload.activeAt)}` : 'uploading'}</small></div>
      <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancel upload of ${upload.fileName}`} onClick={() => void cancel([upload])}>{busy ? <LoaderCircle className="library-spin" /> : 'Cancel'}</Button>
    </li>; })}</ul>
    {error && <p className="dash-error" role="alert">{error}</p>}
    <div className="library-dialog-actions"><Button variant="soft" onClick={onClose}>Close</Button>{count > 1 && <Button variant="primary" disabled={cancelling.size > 0} onClick={() => void cancel(uploads ?? [])}>Cancel all {count}</Button>}</div>
  </DialogContent></Dialog>;
}
