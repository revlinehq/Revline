'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowUpRight, Check, Film, Globe, LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { formatTime, timelineDuration, type MediaAsset, type Timeline } from '@/lib/editor/types';
import './timeline-sharing.css';

type ShareStatus = { _id: string; title: string; published: boolean; updatedAt: number } | null;
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: string; timeline: Timeline; assets: MediaAsset[]; status: ShareStatus | undefined;
  onPublish: () => Promise<string>; onRevoke: () => Promise<unknown>; publishDisabled?: boolean;
};
const ratios = { landscape: '16:9', vertical: '9:16', square: '1:1', classic: '4:3', 'portrait-feed': '4:5' };
export function timelineSharePath(shareId: string) { return `/editor/showcase/${encodeURIComponent(shareId)}`; }
export function timelineShareCover(timeline: Timeline, assets: MediaAsset[]) {
  const clip = timeline.clips.find(clip => clip.kind === 'video' || clip.kind === 'image');
  const asset = assets.find(asset => asset._id === clip?.assetId);
  return asset?.thumbnailUrl ?? (asset?.kind === 'image' ? asset.url : null);
}

export function ConnectedTimelineShareDialog({ projectId, onBeforePublish, ...props }: Omit<Props, 'status' | 'onPublish' | 'onRevoke'> & { projectId: Id<'projects'>; onBeforePublish: () => Promise<void> }) {
  const status = useQuery(api.timelineShares.status, props.open ? { projectId } : 'skip');
  const publish = useMutation(api.timelineShares.publish), revoke = useMutation(api.timelineShares.revoke);
  return <TimelineShareDialog {...props} status={status} onPublish={async () => { await onBeforePublish(); return publish({ projectId }); }} onRevoke={() => revoke({ projectId })}/>;
}

export function TimelineShareDialog({ open, onOpenChange, title, timeline, assets, status, onPublish, onRevoke, publishDisabled }: Props) {
  const [busy, setBusy] = useState<'publish' | 'revoke' | null>(null);
  const [error, setError] = useState(''), [copied, setCopied] = useState(false), [origin, setOrigin] = useState('');
  const [localId, setLocalId] = useState<string | null | undefined>();
  const inFlight = useRef(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { setLocalId(undefined); }, [status?.updatedAt, status?.published]);
  useEffect(() => { if (open) { setCopied(false); setError(''); } }, [open]);
  const shareId = localId !== undefined ? localId : status?.published ? status._id : null;
  const url = shareId ? `${origin}${timelineSharePath(shareId)}` : '';
  const cover = timelineShareCover(timeline, assets);
  async function publish() {
    if (inFlight.current || publishDisabled || status === undefined) return;
    inFlight.current = true; setBusy('publish'); setError(''); setCopied(false);
    try { setLocalId(await onPublish()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not share this timeline.'); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function revoke() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('revoke'); setError(''); setCopied(false);
    try { await onRevoke(); setLocalId(null); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not turn off sharing.'); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setError(''); }
    catch { setError('Could not copy the link. Select it above and copy it manually.'); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!inFlight.current) onOpenChange(value); }}>
    <DialogContent className="timeline-share-dialog workspace-dialog">
      <DialogTitle>Share timeline</DialogTitle>
      <DialogDescription>Let people watch your edit and explore its timeline.</DialogDescription>
      <div className="timeline-share-summary"><div className="timeline-share-cover">{cover ? <img src={cover} alt=""/> : <Film size={24} strokeWidth={1.25}/>}</div><div><strong>{title}</strong><span>{formatTime(timelineDuration(timeline))} · {ratios[timeline.aspectRatio]}</span></div></div>
      <div className="timeline-share-access"><span><Globe size={16}/>Anyone with the link can view</span><p>Use timeline includes the edit and its original footage.</p></div>
      {status === undefined ? <p className="timeline-share-status" role="status"><LoaderCircle size={13} className="animate-spin"/>Loading sharing settings…</p> : shareId ? <>
        <div className="timeline-share-link"><input aria-label="Timeline sharing link" readOnly value={url} onFocus={event => event.currentTarget.select()}/><PrimaryButton size="compact" onClick={() => void copy()} disabled={!!busy}>{copied ? <><Check size={13}/>Copied</> : 'Copy link'}</PrimaryButton></div>
        <p className="timeline-share-status" role="status">{busy === 'publish' ? 'Updating your shared timeline…' : 'Link is live'}</p>
        <div className="timeline-share-actions"><button type="button" onClick={() => void revoke()} disabled={!!busy}>{busy === 'revoke' ? 'Turning off sharing…' : 'Turn off sharing'}</button><a href={url} target="_blank" rel="noopener noreferrer">Open timeline<ArrowUpRight size={13}/></a></div>
        <button type="button" className="timeline-share-update" onClick={() => void publish()} disabled={!!busy || publishDisabled}>Update link with latest saved edit</button>
      </> : <><p className="timeline-share-status">Your edit stays private until you create a link.</p><PrimaryButton className="timeline-share-create" onClick={() => void publish()} disabled={!!busy || publishDisabled}>{busy === 'publish' && <LoaderCircle size={14} className="animate-spin"/>}{busy === 'publish' ? 'Creating link…' : 'Create link'}</PrimaryButton></>}
      {error && <p className="timeline-sharing-error" role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}
