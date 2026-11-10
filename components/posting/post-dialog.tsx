'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { LoaderCircle, Send } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { CAPTION_LIMIT, TITLE_LIMIT } from '@/lib/posting/limits';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { BatchLinks } from './batch-links';
import './posting.css';

/** `datetime-local` wants local time without a zone. */
function localInputValue(time: number) { const date = new Date(time - new Date(time).getTimezoneOffset() * 60_000); return date.toISOString().slice(0, 16); }

/** "Post" on a finished export: opens the dialog that sends it to connected accounts, now or on a schedule. */
export function PostButton({ jobId, campaignId, size = 'default', className }: { jobId: string; campaignId?: string; size?: 'default' | 'sm'; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="secondary" size={size} className={className} onClick={() => setOpen(true)}><Send size={size === 'sm' ? 14 : 16} />Post</Button>
    {open && <PostDialog jobId={jobId as Id<'renderJobs'>} campaignId={campaignId} onClose={() => setOpen(false)} />}
  </>;
}

function PostDialog({ jobId, campaignId, onClose }: { jobId: Id<'renderJobs'>; campaignId?: string; onClose: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const createBatch = useMutation(api.posting.createBatch);
  const [caption, setCaption] = useState(''), [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set()), [overrides, setOverrides] = useState<Record<string, string>>({}), [custom, setCustom] = useState<Set<string>>(() => new Set());
  const [later, setLater] = useState(false), [when, setWhen] = useState(() => localInputValue(Date.now() + 3600_000));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sent, setSent] = useState<{ batchId: Id<'postingBatches'>; count: number; scheduled: boolean } | null>(null);
  const usable = accounts?.filter(account => account.status === 'connected') ?? [];
  // Counted from the accounts still connected, so the button never promises more posts than it sends.
  const picked = usable.filter(account => chosen.has(account.id));
  const toggle = (set: Set<string>, id: string, on: boolean) => { const next = new Set(set); if (on) next.add(id); else next.delete(id); return next; };
  async function submit() {
    if (busy || !picked.length) return;
    const scheduledAt = later ? new Date(when).getTime() : undefined;
    if (later && (!Number.isFinite(scheduledAt) || scheduledAt! <= Date.now())) { setError('Pick a time in the future.'); return; }
    setBusy(true); setError('');
    try {
      const targets = picked.map(account => ({ accountId: account.id, ...(custom.has(account.id) && overrides[account.id]?.trim() ? { caption: overrides[account.id] } : {}) }));
      const batchId = await createBatch({ jobId, caption, ...(title.trim() ? { title } : {}), ...(scheduledAt ? { scheduledAt } : {}), ...(campaignId ? { campaignId } : {}), targets });
      setSent({ batchId, count: targets.length, scheduled: !!scheduledAt });
    } catch (reason) { setError(userError(reason, 'Could not create these posts.')); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="posting-dialog">
    {sent ? <>
      <DialogTitle>{sent.scheduled ? 'Scheduled.' : 'On its way.'}</DialogTitle>
      <DialogDescription>{sent.count} {sent.count === 1 ? 'post is' : 'posts are'} {sent.scheduled ? `scheduled for ${new Date(when).toLocaleString()}` : 'being sent now'}. Follow them on the Posts page.</DialogDescription>
      {campaignId && <BatchLinks batchId={sent.batchId} />}
      <div className="posting-dialog-actions"><Button variant="secondary" onClick={onClose}>Done</Button><Button asChild><Link href="/posts">View posts</Link></Button></div>
    </> : <>
      <DialogTitle>Post this video</DialogTitle>
      <DialogDescription>Send this export to your connected accounts, now or at a time you pick.</DialogDescription>
      {!accounts ? <p className="posting-hint" role="status">Loading your accounts…</p> : !usable.length ? <>
        <p className="posting-hint">You have no connected accounts yet. Connect one to post this video.</p>
        <div className="posting-dialog-actions"><Button asChild><Link href="/accounts">Connect an account</Link></Button></div>
      </> : <>
        <div className="posting-field"><label htmlFor="posting-caption">Caption</label><Textarea id="posting-caption" rows={3} maxLength={CAPTION_LIMIT} placeholder="Shared by every account unless you change it below" value={caption} onChange={event => setCaption(event.target.value)} /></div>
        <div className="posting-field"><label htmlFor="posting-title">Title (optional)</label><Input id="posting-title" maxLength={TITLE_LIMIT} placeholder="Used where the platform has titles, such as YouTube" value={title} onChange={event => setTitle(event.target.value)} /></div>
        <div className="posting-field"><span>Accounts</span><div className="posting-targets">{usable.map(account => <div key={account.id} className="posting-target">
          <div className="posting-target-head">
            <label><Checkbox checked={chosen.has(account.id)} onCheckedChange={checked => setChosen(previous => toggle(previous, account.id, checked === true))} /><span>@{account.username}</span><small>{PLATFORM_NAMES[account.platform]}</small></label>
            {chosen.has(account.id) && <Button variant="ghost" size="sm" onClick={() => setCustom(previous => toggle(previous, account.id, !previous.has(account.id)))}>{custom.has(account.id) ? 'Use shared caption' : 'Custom caption'}</Button>}
          </div>
          {chosen.has(account.id) && custom.has(account.id) && <Textarea rows={2} maxLength={CAPTION_LIMIT} aria-label={`Caption for @${account.username}`} placeholder={`Caption for @${account.username}`} value={overrides[account.id] ?? ''} onChange={event => setOverrides(previous => ({ ...previous, [account.id]: event.target.value }))} />}
        </div>)}</div></div>
        <div className="posting-field">
          <label className="posting-target-head"><Checkbox checked={later} onCheckedChange={checked => setLater(checked === true)} /><span>Schedule for later</span></label>
          {later && <Input type="datetime-local" aria-label="Post at" min={localInputValue(Date.now())} value={when} onChange={event => setWhen(event.target.value)} />}
        </div>
        {error && <p className="posting-hint" role="alert" style={{ color: '#b5553d', opacity: 1 }}>{error}</p>}
        <div className="posting-dialog-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !picked.length} onClick={() => void submit()}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Send size={14} />}{later ? `Schedule ${picked.length || ''} ${picked.length === 1 ? 'post' : 'posts'}` : `Post to ${picked.length || ''} ${picked.length === 1 ? 'account' : 'accounts'}`}</Button></div>
      </>}
    </>}
  </DialogContent></Dialog>;
}
