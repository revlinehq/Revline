'use client';
import { userError } from '@/lib/user-error';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowUpRight, Check, Film, Globe, LoaderCircle, RefreshCw } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { formatTime, timelineDuration, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { timelineCover } from '@/lib/editor/timeline-cover';
import { timelineSharePath } from '@/lib/editor/timeline-share';
import type { ShareChatPreview, ShareChatPreviewMessage } from '@/lib/editor/shared-chat';
import { SharedChatMessages } from './shared-chat-messages';
import './timeline-sharing.css';

type ShareStatus = { _id: string; title: string; published: boolean; updatedAt: number; includesChat?: boolean; timelineIds?: string[] } | null;
export type ShareableTab = { id: string; name: string; active: boolean; duration: number };
type Props = {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: string; timeline: Timeline; assets: MediaAsset[]; sceneThumbs?: Record<string, { time: number; image: string }[]>; status: ShareStatus | undefined;
  onPublish: (chat?: ShareChatPreviewMessage[], timelineIds?: string[]) => Promise<string>; tabs?: ShareableTab[]; onRevoke: () => Promise<unknown>; publishDisabled?: boolean;
  chatPreview?: ShareChatPreview; onChatPreviewChange?: (enabled: boolean) => void;
};
const ratios = { landscape: '16:9', vertical: '9:16', square: '1:1', classic: '4:3', 'portrait-feed': '4:5' };

export function ConnectedTimelineShareDialog({ projectId, onBeforePublish, ...props }: Omit<Props, 'status' | 'onPublish' | 'onRevoke'> & { projectId: Id<'projects'>; onBeforePublish: () => Promise<void> }) {
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const chatPreview = useQuery(api.timelineShares.chatPreview, props.open && previewEnabled ? { projectId } : 'skip');
  const status = useQuery(api.timelineShares.status, props.open ? { projectId } : 'skip');
  const tabs = useQuery(api.timelineTabs.list, props.open ? { projectId } : 'skip');
  const publish = useMutation(api.timelineShares.publish), revoke = useMutation(api.timelineShares.revoke);
  // The tab list does not track the open tab's live length; this dialog has the timeline itself.
  const live = tabs?.map(tab => tab.active ? { ...tab, duration: timelineDuration(props.timeline) } : tab);
  return <TimelineShareDialog {...props} tabs={live} status={status} chatPreview={chatPreview} onChatPreviewChange={setPreviewEnabled} onPublish={async (chat, timelineIds) => { await onBeforePublish(); return publish({ projectId, ...(chat ? { chat } : {}), ...(timelineIds ? { timelineIds } : {}) }); }} onRevoke={() => revoke({ projectId })}/>;
}

function TimelineShareDialog({ open, onOpenChange, title, timeline, assets, sceneThumbs, status, onPublish, onRevoke, publishDisabled, chatPreview, onChatPreviewChange, tabs }: Props) {
  const [busy, setBusy] = useState<'publish' | 'revoke' | null>(null);
  const [error, setError] = useState(''), [copied, setCopied] = useState(false), [origin, setOrigin] = useState('');
  const [localId, setLocalId] = useState<string | null | undefined>();
  const [includeChat, setIncludeChat] = useState(false);
  const [picked, setPicked] = useState<string[] | null>(null);
  const inFlight = useRef(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => { setLocalId(undefined); }, [status?.updatedAt, status?.published]);
  useEffect(() => { if (open) { setCopied(false); setError(''); setIncludeChat(false); setPicked(null); } onChatPreviewChange?.(false); }, [open, onChatPreviewChange]);
  const multiTab = (tabs?.length ?? 0) > 1;
  // Until changed, the selection is what the live link shares, or the open tab.
  const shared = status?.published && status.timelineIds?.length ? status.timelineIds : null;
  const selected = picked ?? (tabs ?? []).filter(tab => shared ? shared.includes(tab.id) : tab.active).map(tab => tab.id);
  function toggleTab(id: string, on: boolean) { setPicked((tabs ?? []).filter(tab => tab.id === id ? on : selected.includes(tab.id)).map(tab => tab.id)); setCopied(false); }
  const shareId = localId !== undefined ? localId : status?.published ? status._id : null;
  const url = shareId ? `${origin}${timelineSharePath(shareId)}` : '';
  const cover = timelineCover(timeline, assets, sceneThumbs);
  const chatPending = includeChat && chatPreview === undefined, noTabs = multiTab && !selected.length;
  function toggleChat(enabled: boolean) { setIncludeChat(enabled); onChatPreviewChange?.(enabled); setCopied(false); }
  async function publish() {
    if (inFlight.current || publishDisabled || status === undefined || chatPending || noTabs) return;
    inFlight.current = true; setBusy('publish'); setError(''); setCopied(false);
    try { setLocalId(await onPublish(includeChat ? chatPreview?.messages : undefined, multiTab ? selected : undefined)); }
    catch (error) { setError(userError(error, 'Could not share this timeline.')); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function revoke() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('revoke'); setError(''); setCopied(false);
    try { await onRevoke(); setLocalId(null); }
    catch (error) { setError(userError(error, 'Could not turn off sharing.')); }
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
      {multiTab && <fieldset className="timeline-share-tabs" disabled={!!busy}><legend>Timelines</legend><p>Viewers can switch between the timelines you include.</p>{tabs!.map(tab => <label key={tab.id}><input type="checkbox" checked={selected.includes(tab.id)} onChange={event => toggleTab(tab.id, event.currentTarget.checked)}/><span>{tab.name}</span><small>{formatTime(tab.duration)}</small></label>)}</fieldset>}
      <div className="timeline-share-chat"><label><span>Include chat history</span><input type="checkbox" role="switch" checked={includeChat} onChange={event => toggleChat(event.currentTarget.checked)} disabled={!!busy}/></label><p>{includeChat ? 'Only the messages in this preview will be shared. Later messages stay private.' : status?.published && status.includesChat ? 'This link already includes a chat snapshot. Update with this off to remove it.' : 'Your conversation stays private.'}</p>{includeChat && (chatPreview === undefined ? <p role="status">Loading chat preview…</p> : chatPreview.messages.length ? <details><summary>Preview {chatPreview.messages.length} messages</summary><SharedChatMessages messages={chatPreview.messages}/>{chatPreview.truncated && <p>Showing recent messages. Long messages may be shortened.</p>}</details> : <p>No messages to share.</p>)}</div>
      {status === undefined ? <p className="timeline-share-status" role="status"><LoaderCircle size={13} className="animate-spin"/>Loading sharing settings…</p> : shareId ? <>
        <div className="timeline-share-update-block"><PrimaryButton className="timeline-share-update" onClick={() => void publish()} disabled={!!busy || publishDisabled || chatPending || noTabs} aria-describedby="timeline-share-update-note">{busy === 'publish' ? <LoaderCircle size={14} className="animate-spin"/> : <RefreshCw size={14}/>} {busy === 'publish' ? 'Updating link…' : 'Update link with latest saved edit'}</PrimaryButton><p id="timeline-share-update-note">Publish your latest changes to this same link.</p></div>
        <div className="timeline-share-link"><input aria-label="Timeline sharing link" readOnly value={url} onFocus={event => event.currentTarget.select()}/><PrimaryButton size="compact" onClick={() => void copy()} disabled={!!busy}>{copied ? <><Check size={13}/>Copied</> : 'Copy link'}</PrimaryButton></div>
        <p className="timeline-share-status" role="status">{busy === 'publish' ? 'Updating your shared timeline…' : `Link is live${status?.includesChat ? ' · Includes chat history' : ''}`}</p>
        <div className="timeline-share-actions"><button type="button" onClick={() => void revoke()} disabled={!!busy}>{busy === 'revoke' ? 'Turning off sharing…' : 'Turn off sharing'}</button><a href={url} target="_blank" rel="noopener noreferrer">Open timeline<ArrowUpRight size={13}/></a></div>
      </> : <><p className="timeline-share-status">Your edit stays private until you create a link.</p><PrimaryButton className="timeline-share-create" onClick={() => void publish()} disabled={!!busy || publishDisabled || chatPending || noTabs}>{busy === 'publish' && <LoaderCircle size={14} className="animate-spin"/>}{busy === 'publish' ? 'Creating link…' : 'Create link'}</PrimaryButton></>}
      {error && <p className="timeline-sharing-error" role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}
