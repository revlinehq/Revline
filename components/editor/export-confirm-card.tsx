'use client';
import { useEffect, useState } from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Download } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { aspectRatioLabel, formatTime, type AspectRatio } from '@/lib/editor/types';
import { plainFailureText, refusalReason } from '@/lib/ai/failure-text';
import { reportClientFailure } from '@/lib/incident-client';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field';
import type { ChatTool } from './chat-types';
import './post-confirm-card.css';

/** The export card an exportVideo step left in the chat; null for any other step. */
export function exportProposalOf(step: ChatTool): Id<'exportProposals'> | null {
  const output = step.output;
  if (step.state !== 'done' || step.name !== 'exportVideo' || !output) return null;
  return typeof output.proposalId === 'string' ? output.proposalId as Id<'exportProposals'> : null;
}

type Proposal = {
  status: 'proposed' | 'confirmed' | 'cancelled' | 'expired'; expiresAt: number; timeline: string; duration: number; aspectRatio: AspectRatio;
  settings: { resolution: number; fps: number; quality: string }; changed: string[];
  job: { jobId: Id<'renderJobs'>; status: 'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled'; progress: number; error: string | null; ready: boolean } | null;
};
const RESOLUTION_NAMES: Record<number, string> = { 720: '720p', 1080: '1080p', 2160: '4K' };
const QUALITY_NAMES: Record<string, string> = { draft: 'Draft', standard: 'Standard', high: 'High' };
/** The reason a press failed, as the server wrote it. */
const reasonOf = (error: unknown, fallback: string) => { reportClientFailure(error); return refusalReason(error) || plainFailureText(error) || fallback; };

/**
 * What the assistant asked to export, for the user to confirm. Nothing renders until Export is pressed here: the
 * assistant cannot press it. After the press the card follows the export and offers the same download as the
 * editor's export list.
 */
export function ExportConfirmCard({ proposalId, disabled }: { proposalId: Id<'exportProposals'>; disabled: boolean }) {
  const proposal = useQuery(api.assistantExports.proposal, { proposalId }) as Proposal | null | undefined;
  const confirm = useMutation(api.assistantExports.confirmProposal), cancel = useMutation(api.assistantExports.cancelProposal), stop = useMutation(api.renders.cancel), download = useAction(api.renders.download);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The query does not re-run as time passes, so the card reads the clock itself to stop offering an expired press.
  const [now, setNow] = useState(() => Date.now());
  const waiting = proposal?.status === 'proposed';
  useEffect(() => { if (!waiting) return; const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, [waiting]);
  if (!proposal) return null;
  const status = proposal.status === 'proposed' && proposal.expiresAt <= now ? 'expired' : proposal.status, { settings, job } = proposal;
  const changed = new Set(proposal.changed);
  async function run(work: () => Promise<unknown>, fallback: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (reason) { setError(reasonOf(reason, fallback)); } finally { setBusy(false); }
  }
  const mark = (key: string) => changed.has(key) ? ' (asked in chat)' : '';
  const rendering = job && (job.status === 'queued' || job.status === 'rendering');
  return <FieldSet className="post-confirm-card" data-status={status} data-job={job?.status}>
    <FieldLegend variant="label">{status === 'proposed' ? `Export ${proposal.timeline}?` : `Export of ${proposal.timeline}`}</FieldLegend>
    <dl>
      <div><dt>Timeline</dt><dd><span>{proposal.timeline} · {formatTime(proposal.duration)} · {aspectRatioLabel(proposal.aspectRatio)}</span></dd></div>
      <div><dt>Resolution</dt><dd><span>{RESOLUTION_NAMES[settings.resolution] ?? `${settings.resolution}p`}{mark('resolution')}</span></dd></div>
      <div><dt>Frame rate</dt><dd><span>{settings.fps} fps{mark('fps')}</span></dd></div>
      <div><dt>Quality</dt><dd><span>{QUALITY_NAMES[settings.quality] ?? settings.quality}{mark('quality')}</span></dd></div>
    </dl>
    {status === 'proposed' ? <>
      <FieldDescription>{changed.size ? 'Your usual export settings, with the change you asked for. It applies to this export only.' : 'Your usual export settings.'} Nothing renders until you press Export.</FieldDescription>
      <div className="post-confirm-actions">
        <Button type="button" variant="primary" size="sm" disabled={disabled || busy} onClick={() => void run(() => confirm({ proposalId }), 'Could not start this export.')}>Export</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => cancel({ proposalId }), 'Could not cancel this export.')}>Cancel</Button>
      </div>
    </> : status === 'cancelled' ? <FieldDescription role="status">Cancelled. Nothing was exported.</FieldDescription>
      : status === 'expired' ? <FieldDescription role="status">This confirmation expired. Nothing was exported; ask again to export it.</FieldDescription>
      : !job ? <FieldDescription role="status">This export is no longer available.</FieldDescription>
      : rendering ? <>
        <FieldDescription role="status">{job.status === 'queued' ? 'Waiting for a renderer…' : `Exporting… ${Math.round(job.progress)}%`}</FieldDescription>
        <div className="post-confirm-actions"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => stop({ jobId: job.jobId }), 'Could not stop this export.')}>Stop export</Button></div>
      </>
      : job.ready ? <div className="post-confirm-actions">
        <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => void run(async () => { window.location.assign(await download({ jobId: job.jobId })); }, 'Could not download this export.')}><Download aria-hidden="true"/>Download</Button>
      </div>
      : <FieldDescription role="status">{job.status === 'cancelled' ? 'The export was stopped. Your edit is unchanged.' : `The export failed. ${plainFailureText(job.error) || 'Your edit is unchanged; ask again to export it.'}`}</FieldDescription>}
    {error && <FieldDescription role="alert" data-error>{error}</FieldDescription>}
  </FieldSet>;
}
