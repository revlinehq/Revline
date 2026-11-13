'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ChevronDown, LoaderCircle, Upload } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { AI_USAGE_WARNING } from '@/lib/billing/plan';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { usePlanUsage } from '@/components/workspace/plan-usage';
import { usePlanStatus } from '@/components/workspace/use-plan-status';
import { canUpgrade, meterLevel } from '@/components/workspace/plan-limit-dialog';
import { userError } from '@/lib/user-error';
import { formatBytes } from './format';
import './library.css';

type Unfinished = FunctionReturnType<typeof api.cloudMedia.unfinished>[number];
const KINDS = [['videoBytes', 'Video'], ['audioBytes', 'Audio'], ['imageBytes', 'Images'], ['modelBytes', 'Models'], ['exportBytes', 'Exports']] as const;
/** Parts are up to 95 MB, so only a long silence suggests a closed tab rather than a slow link. */
const QUIET_MS = 30 * 60_000;
function elapsed(ms: number) { const minutes = Math.floor(ms / 60_000); if (minutes < 1) return 'under a minute'; if (minutes < 60) return `${minutes} min`; const hours = Math.floor(minutes / 60); return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`; }

/** Storage in the profile menu: what is stored (with uploads still reserving room) against the plan's limit, as
 *  Settings → Plan counts it (convex/lib/plan_limits.ts refuses uploads past it). Without a limit (billing off, or
 *  no plan) the bar splits what is used by kind. Opening it lists each kind; from 80% it offers an upgrade. */
export function StorageMeter({ onNavigate, onReview }: { onNavigate: () => void; onReview: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const usage = usePlanUsage(), status = usePlanStatus();
  const summary = useQuery(api.storage.summary, isAuthenticated ? {} : 'skip');
  if (!usage) return <div className="storage-meter" aria-busy="true"><Skeleton className="h-4 w-32" /><Skeleton className="h-1 w-full" /></div>;
  const { usedBytes, reservedBytes, limitBytes: limit } = usage.storage, stored = usedBytes + reservedBytes;
  const share = limit ? stored / limit : 0, level = limit === null ? undefined : meterLevel(share, AI_USAGE_WARNING);
  const label = limit === null ? `${formatBytes(stored)} used` : `${formatBytes(stored)} of ${formatBytes(limit)}`;
  const upgrade = level !== undefined && canUpgrade(status);
  const kinds = summary?.ready ? summary : null;
  return <div className="storage-meter plan-meter" data-level={level}>
    <Collapsible>
      <CollapsibleTrigger asChild><Button variant="ghost" className="storage-meter-toggle" aria-label={`Storage: ${label}. Show storage by kind`}>
        <span className="plan-meter-label"><span>Storage</span><small>{label}</small><ChevronDown aria-hidden="true" /></span>
        {limit !== null
          ? <Progress value={Math.min(100, Math.round(share * 100))} aria-hidden="true" />
          : <span className="library-meter" aria-hidden="true">{KINDS.map(([field]) => <i key={field} data-kind={field} style={{ width: `${kinds && kinds.usedBytes > 0 ? kinds[field] / kinds.usedBytes * 100 : 0}%` }} />)}</span>}
      </Button></CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="storage-meter-kinds">{KINDS.map(([field, name]) => <li key={field}><i data-kind={field} />{name}<span>{kinds ? formatBytes(kinds[field]) : '…'}</span></li>)}</ul>
      </CollapsibleContent>
    </Collapsible>
    {level === 'full' && <p>Your storage is full. Delete files or upgrade your plan to upload more. Nothing stored is removed.</p>}
    {reservedBytes > 0 && <p>{formatBytes(reservedBytes)} reserved for uploads in progress. <Button variant="link" size="sm" className="storage-meter-link" onClick={onReview}>Review</Button></p>}
    {upgrade && <Button asChild variant="link" size="sm" className="storage-meter-link"><Link href="/profile#billing" onClick={onNavigate}>Upgrade</Link></Button>}
  </div>;
}

/** Uploads still reserving room, with a way to cancel them. Rendered outside the menu, which closes when it opens. */
export function UnfinishedUploads({ onClose }: { onClose: () => void }) {
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
