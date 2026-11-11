'use client';
// Post from the editor. Posting needs a file, so one press exports the open timeline (or reuses a finished export
// of the unchanged timeline) and then posts it: convex/postExports.ts. This is the button, its popover, and the
// states that replace it while the export and the posts run.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { CalendarClock, Check, ChevronDown, CircleAlert, CircleCheck, Copy, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { CAPTION_LIMIT } from '@/lib/posting/limits';
import { PLATFORM_NAMES, POSTING_PLATFORMS } from '@/lib/posting/platform-names';
import { YOUTUBE_VISIBILITY_NAMES } from '@/lib/posting/visibility';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import './editor-post.css';

/** How long a finished or failed post keeps its place beside Export. */
const RECENT_MS = 24 * 3600_000;
const clock = (time: number) => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const day = (time: number) => new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const accountsLabel = (count: number) => `${count} ${count === 1 ? 'account' : 'accounts'}`;
async function copyText(text: string) { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  // "Copied" is about this text and only for a moment.
  useEffect(() => { setCopied(false); }, [text]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer); }, [copied]);
  return <Button type="button" data-slot="button" variant="soft" size="sm" disabled={!text} onClick={() => void copyText(text).then(setCopied)}>{copied ? <Check /> : <Copy />}{copied ? 'Copied' : label}</Button>;
}

export function EditorPost({ projectId, timelineId, disabled, onBeforePost }: {
  projectId: Id<'projects'>;
  /** The timeline tab on screen, so the post is of the clip the user is looking at. */
  timelineId?: string;
  /** Nothing to post yet, or an edit is running. */
  disabled?: boolean;
  /** Waits for the editor's pending saves, so the export is the version on screen. */
  onBeforePost: () => Promise<void>;
}) {
  const pending = useQuery(api.postExports.latest, { projectId });
  const accounts = useQuery(api.posting.accounts, {});
  const platforms = useQuery(api.posting.platforms, {});
  const youtubeOptions = useQuery(api.posting.options, {})?.youtubeVisibilities;
  const start = useMutation(api.postExports.start), cancel = useMutation(api.postExports.cancel);
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState(''), [when, setWhen] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Re-read the clock each minute, so a finished post leaves the bar a day later without a reload.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  const live = new Set((platforms ?? []).filter(item => item.live).map(item => item.platform));
  const selectable = (accounts ?? []).filter(account => account.status === 'connected' && live.has(account.platform));
  const picked = selectable.filter(account => chosen.has(account.id));

  const exporting = pending?.status === 'waiting' || pending?.status === 'queued';
  const total = pending?.accounts ?? 0;
  const inFlight = pending?.status === 'created' && pending.sending > 0;
  const posted = pending?.status === 'created' && !inFlight && pending.published > 0 && pending.scheduled === 0;
  const scheduled = pending?.status === 'created' && !inFlight && pending.scheduled > 0;
  const failure = pending?.status === 'failed' ? pending.error ?? 'This post could not be sent.' : pending?.status === 'created' && !inFlight && pending.failed > 0 ? pending.postError ?? 'A post could not be sent.' : '';
  const recent = !!pending && now - pending.createdAt < RECENT_MS;

  /** A picked time makes this a scheduled post; without one it goes out now. */
  const schedule = !!when;
  async function submit() {
    if (busy || !picked.length) return;
    const scheduledAt = schedule ? new Date(when).getTime() : undefined;
    if (schedule && (!Number.isFinite(scheduledAt) || scheduledAt! <= Date.now())) { setError('Pick a date and time in the future.'); return; }
    setBusy(true); setError('');
    try {
      await onBeforePost();
      await start({ projectId, ...(timelineId ? { timelineId } : {}), caption, accountIds: picked.map(account => account.id), ...(scheduledAt ? { scheduledAt } : {}) });
      setOpen(false);
    } catch (reason) { setError(userError(reason, schedule ? 'Could not schedule this post.' : 'Could not start this post.')); }
    finally { setBusy(false); }
  }

  if (exporting || inFlight) return <div className="editor-post-state" role="status">
    <span className="editor-post-pill">
      {exporting ? pending!.scheduledAt ? 'Exporting, then scheduling' : 'Exporting, then posting' : `Posting to ${accountsLabel(total)}`}
      {exporting && <Progress className="editor-post-progress" aria-label="Export progress" max={100} value={pending!.exportStatus === 'rendering' ? pending!.exportProgress : 0} />}
      {exporting && <Button type="button" variant="ghost" size="icon-xs" className="editor-post-cancel" aria-label="Cancel this post" title="Cancel this post. The export keeps going." onClick={() => void cancel({ pendingId: pending!.id }).catch(() => {})}><X /></Button>}
    </span>
    <span className="editor-post-note">{pending!.scheduledAt ? `Posts ${day(pending!.scheduledAt)}. ` : ''}Posting the version from {clock(pending!.createdAt)}.</span>
  </div>;

  const status = !recent ? null : posted ? <span className="editor-post-pill editor-post-status"><CircleCheck />{failure ? `Posted to ${pending!.published} of ${accountsLabel(total)}` : `Posted to ${accountsLabel(pending!.published)}`}</span> : scheduled ? <span className="editor-post-pill editor-post-status"><CalendarClock />Scheduled for {day(pending!.scheduledAt ?? pending!.createdAt)}</span>
    : failure ? <Popover><PopoverTrigger asChild><Button type="button" data-slot="button" variant="soft" size="sm" className="editor-post-status" data-failed><CircleAlert />Post failed</Button></PopoverTrigger><PopoverContent align="end" sideOffset={10} className="editor-post-card"><p className="editor-post-hint" role="alert">{failure}</p></PopoverContent></Popover> : null;

  return <div className="editor-post-state">
    {status}
    {status && (posted || scheduled) && <Button asChild variant="ghost" size="sm" className="editor-post-view"><Link href="/posts">View posts</Link></Button>}
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setError(''); }}>
      <PopoverTrigger asChild><Button type="button" data-slot="button" variant="primary" size="sm" className="editor-post-open" disabled={disabled}>Post<ChevronDown /></Button></PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="editor-post-card editor-post-menu">
        <div className="editor-post-row"><label htmlFor="editor-post-caption">Caption</label><CopyButton text={caption} /></div>
        <Textarea id="editor-post-caption" className="editor-post-caption" rows={4} maxLength={CAPTION_LIMIT} placeholder="Write a caption" value={caption} onChange={event => setCaption(event.target.value)} />
        <span className="editor-post-label">Post to</span>
        {!accounts || !platforms ? <p className="editor-post-hint" role="status">Loading your accounts…</p> : accounts.length ? <ul className="editor-post-accounts">{accounts.map(account => {
          const soon = !live.has(account.platform), usable = !soon && account.status === 'connected';
          return <li key={account.id} data-disabled={!usable || undefined}><label>
            <Checkbox disabled={!usable} checked={usable && chosen.has(account.id)} onCheckedChange={checked => setChosen(previous => { const next = new Set(previous); if (checked === true) next.add(account.id); else next.delete(account.id); return next; })} />
            <span className="editor-post-account">@{account.username}</span><small>{PLATFORM_NAMES[account.platform]}</small>
          </label>{soon ? <em>Coming soon</em> : !usable && <Link href="/accounts">Reconnect</Link>}</li>;
        })}</ul> : <ul className="editor-post-accounts">{POSTING_PLATFORMS.map(platform => <li key={platform} data-disabled={!live.has(platform) || undefined}>
          <label><Checkbox disabled checked={false} aria-label={PLATFORM_NAMES[platform]} /><span className="editor-post-account">{PLATFORM_NAMES[platform]}</span></label>
          {live.has(platform) ? <Link href="/accounts">Connect</Link> : <em>Coming soon</em>}
        </li>)}</ul>}
        <div className="editor-post-schedule">
          <Input type="datetime-local" className="editor-post-when" aria-label="Schedule for a date and time (optional)" value={when} onChange={event => { const next = event.target.value; setWhen(next); setError(next && new Date(next).getTime() <= Date.now() ? 'Pick a date and time in the future.' : ''); }} />
        </div>
        <Button type="button" variant="primary" className="editor-post-now" disabled={busy || !picked.length} onClick={() => void submit()}>{schedule ? busy ? 'Scheduling…' : 'Schedule' : busy ? 'Posting…' : 'Post now'}</Button>
        {error && <p className="editor-post-hint" role="alert" data-error>{error}</p>}
        <p className="editor-post-hint">{schedule ? 'Revline exports this clip first, then schedules it.' : 'Revline exports this clip first, then posts it.'}{youtubeOptions?.length === 1 && picked.some(account => account.platform === 'youtube') && ` YouTube videos are posted as ${YOUTUBE_VISIBILITY_NAMES[youtubeOptions[0]]}.`}</p>
      </PopoverContent>
    </Popover>
  </div>;
}
