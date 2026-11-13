'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAction, useConvexAuth, useMutation, useQuery } from 'convex/react';
import { CalendarDays, Pencil, Send } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { CAPTION_LIMIT, POSTING_NOT_SET_UP, TITLE_LIMIT } from '@/lib/posting/limits';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { YOUTUBE_VISIBILITY_NOTE } from '@/lib/posting/visibility';
import { userError } from '@/lib/user-error';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { ProjectCover } from '@/components/workspace/project-cover';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AccountAvatar, PlatformIcon } from './account-avatar';
import { localInputValue, postTime } from './post-time';
import { NO_TIKTOK_CHOICE, TikTokConsent, TikTokPostSettings, tiktokProblem, tiktokTarget, type TikTokChoice, type TikTokCreator } from './tiktok-post-settings';
import './posting.css';

function clipLength(seconds: number) { const total = Math.round(seconds); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; }

/** "Post" on a finished export: opens the dialog that sends it to connected accounts, now or on a schedule. */
export function PostButton({ jobId, size = 'default', className }: { jobId: string; size?: 'default' | 'sm'; className?: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button variant="secondary" size={size} className={className} onClick={() => setOpen(true)}><Send size={size === 'sm' ? 14 : 16} />Post</Button>
    {open && <PostDialog jobId={jobId as Id<'renderJobs'>} onClose={() => setOpen(false)} />}
  </>;
}

/** A timeline tab in the editor, posted through the export-then-post flow (convex/postExports.ts). */
export type PostTimeline = {
  projectId: Id<'projects'>; timelineId: string; name: string; durationSeconds: number; coverUrl: string | null;
  /** Waits for the editor's pending saves, so the export is the version on screen. */
  onBeforePost: () => Promise<void>;
};

/**
 * Post one clip (a finished export) to connected accounts, now or at a picked time. Without `jobId` the dialog
 * offers the owner's recent finished exports to choose from. With `timeline` it posts that editor tab instead:
 * Revline exports it first (or reuses a finished export of the same version), then posts. `onPostsPage`: the new
 * row is already in view behind the dialog, so it closes on success instead of pointing at the Posts page.
 * `scheduleAt` fills the schedule in: "Post here" on a calendar day.
 */
export function PostDialog({ jobId, timeline, onPostsPage = false, scheduleAt, onClose }: { jobId?: Id<'renderJobs'>; timeline?: PostTimeline; onPostsPage?: boolean; scheduleAt?: number; onClose: () => void }) {
  const { isAuthenticated } = useConvexAuth();
  const finished = useQuery(api.posting.finishedClips, isAuthenticated && !jobId && !timeline ? {} : 'skip');
  const [choice, setChoice] = useState<Id<'renderJobs'> | null>(null);
  // The newest export is offered first, then stays put: an export finishing while the dialog is open must not swap the clip under the caption.
  const newest = finished?.[0]?.jobId;
  useEffect(() => { if (newest) setChoice(previous => previous ?? newest); }, [newest]);
  const current = jobId ?? choice ?? undefined;
  const exported = useQuery(api.posting.clip, isAuthenticated && current ? { jobId: current } : 'skip');
  /** What is posted: the export, or the timeline tab that is exported first. */
  const clip = timeline ? { label: timeline.name, durationSeconds: timeline.durationSeconds, coverUrl: timeline.coverUrl, coverKind: timeline.coverUrl ? 'image' as const : null } : exported;
  const platforms = useQuery(api.posting.platforms, isAuthenticated ? {} : 'skip');
  const accounts = useQuery(api.posting.accounts, isAuthenticated ? {} : 'skip');
  const createBatch = useMutation(api.posting.createBatch), startPost = useMutation(api.postExports.start), readCreator = useAction(api.postingActions.tiktokCreator);
  const [creators, setCreators] = useState<Record<string, TikTokCreator>>({}), [tiktok, setTiktok] = useState<Record<string, TikTokChoice>>({});
  /** The latest creator-info request per picked TikTok account: an answer to an older one is dropped. */
  const asked = useRef(new Map<string, number>());
  const [caption, setCaption] = useState(''), [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set()), [overrides, setOverrides] = useState<Record<string, string>>({}), [perAccount, setPerAccount] = useState(false);
  const [when, setWhen] = useState(() => scheduleAt ? localInputValue(scheduleAt) : '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [sent, setSent] = useState<{ count: number; scheduledAt?: number; tiktok: boolean; exporting: boolean } | null>(null);
  const live = new Set(platforms?.filter(entry => entry.live).map(entry => entry.platform));
  // Only accounts that can post right now can be picked, so the buttons never promise more posts than they send.
  const usable = accounts?.filter(account => account.status === 'connected' && live.has(account.platform)) ?? [];
  const picked = usable.filter(account => chosen.has(account.id));
  const custom = picked.filter(account => overrides[account.id]?.trim()).length, titled = picked.some(account => account.platform === 'youtube');
  const onTikTok = picked.filter(account => account.platform === 'tiktok'), tiktokIds = onTikTok.map(account => account.id).join(' ');
  /** TikTok's rules: the account's current settings are read each time the dialog shows it, not kept from before. */
  function loadCreator(accountId: Id<'postingAccounts'>) {
    const request = (asked.current.get(accountId) ?? 0) + 1;
    asked.current.set(accountId, request);
    setCreators(({ [accountId]: _, ...rest }) => rest);
    void readCreator({ accountId }).catch(reason => ({ ok: false as const, error: userError(reason, 'TikTok’s settings for this account could not be loaded.') }))
      .then(creator => { if (asked.current.get(accountId) === request) setCreators(previous => ({ ...previous, [accountId]: creator })); });
  }
  useEffect(() => {
    const shown = new Set(onTikTok.map(account => account.id));
    // An account that was unticked is read again when it is ticked again.
    for (const accountId of [...asked.current.keys()]) if (!shown.has(accountId as Id<'postingAccounts'>)) asked.current.delete(accountId);
    for (const account of onTikTok) if (!asked.current.has(account.id)) loadCreator(account.id);
  }, [tiktokIds]);
  // The first thing still missing for a TikTok account; the post buttons stay off until there is none.
  /** Posting is not set up on the server: the accounts are listed but none can be picked, and the line beside the buttons says why. */
  const off = !!platforms && !live.size;
  const blocked = off ? POSTING_NOT_SET_UP : onTikTok.map(account => tiktokProblem(account.username, creators[account.id], tiktok[account.id] ?? NO_TIKTOK_CHOICE, clip?.durationSeconds ?? null)).find(Boolean) ?? '';
  /** A picked time makes this a scheduled post; without one it goes out now. */
  const schedule = !!when;
  async function submit() {
    if (busy || !picked.length || !clip || blocked) return;
    const scheduledAt = schedule ? new Date(when).getTime() : undefined;
    if (schedule && (!Number.isFinite(scheduledAt) || scheduledAt! <= Date.now())) { setError('Pick a time in the future.'); return; }
    setBusy(true); setError('');
    try {
      const targets = picked.map(account => ({
        accountId: account.id, ...(overrides[account.id]?.trim() ? { caption: overrides[account.id] } : {}),
        ...(account.platform === 'tiktok' ? tiktokTarget(creators[account.id], tiktok[account.id] ?? NO_TIKTOK_CHOICE) : {}),
      }));
      const text = { caption, ...(titled && title.trim() ? { title } : {}), ...(scheduledAt ? { scheduledAt } : {}) };
      if (timeline) {
        await timeline.onBeforePost();
        await startPost({ projectId: timeline.projectId, timelineId: timeline.timelineId, ...text, accountIds: targets.map(target => target.accountId), targets });
      } else if ('jobId' in clip) await createBatch({ jobId: clip.jobId, ...text, targets });
      if (onPostsPage) onClose();
      else setSent({ count: targets.length, scheduledAt, tiktok: onTikTok.length > 0, exporting: !!timeline });
    } catch (reason) { setError(userError(reason, schedule ? 'Could not schedule this clip.' : 'Could not post this clip.')); }
    finally { setBusy(false); }
  }
  const label = clip?.label ?? finished?.find(entry => entry.jobId === current)?.label;
  const detail = clip && clip.durationSeconds !== null ? clipLength(clip.durationSeconds) : '';
  const missing = jobId ? clip === null : !timeline && finished !== undefined && !finished.length;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="post-dialog">
    <div className="post-dialog-head"><DialogTitle>{sent ? sent.scheduledAt ? 'Scheduled' : 'Posting now' : 'Post clip'}</DialogTitle></div>
    <DialogDescription className="sr-only">Send this clip to your connected accounts, now or at a time you pick.</DialogDescription>
    {sent ? <>
      <div className="post-dialog-done">
        <p>{sent.exporting ? 'Exporting this video, then ' : ''}{sent.scheduledAt ? `${sent.exporting ? 'scheduling' : 'Scheduled'} for ${postTime(sent.scheduledAt)} · ${sent.count} ${sent.count === 1 ? 'account' : 'accounts'}.` : `${sent.exporting ? 'posting' : 'Posting'} to ${sent.count} ${sent.count === 1 ? 'account' : 'accounts'}.`} {sent.exporting ? 'Follow it beside Post at the top of the editor, or on the Posts page.' : 'Follow it on the Posts page.'}</p>
        {sent.tiktok && <p>TikTok can take a few minutes to process a video before it shows on the profile.</p>}
      </div>
      <div className="post-dialog-foot"><Button variant="soft" onClick={onClose}>Done</Button><Button asChild variant="primary"><Link href="/posts">View posts</Link></Button></div>
    </> : missing ? <>
      <div className="post-dialog-done">{jobId ? <p>This clip can no longer be posted. Export it again, then post it.</p> : <><h3>No clips to post yet</h3><p>Export a clip in the editor, then post it from here.</p></>}</div>
      <div className="post-dialog-foot"><Button variant="soft" onClick={onClose}>Close</Button>{!jobId && <Button asChild variant="primary"><Link href={NEW_PROJECT_PATH}>Open the editor</Link></Button>}</div>
    </> : <>
      <div className="post-dialog-body">
        <div className="post-dialog-side">
          <Card variant="tile" className="post-clip">
            <span className="post-clip-thumb"><ProjectCover url={clip?.coverUrl ?? null} kind={clip?.coverKind ?? null} /></span>
            <div className="post-clip-text">
              {finished && finished.length > 1 && current ? <Select value={current} onValueChange={value => setChoice(value as Id<'renderJobs'>)}>
                <SelectTrigger className="post-clip-select" aria-label="Clip to post"><SelectValue /></SelectTrigger>
                <SelectContent className="post-select">{finished.map(entry => <SelectItem key={entry.jobId} value={entry.jobId}>{entry.label} · {postTime(entry.createdAt)}</SelectItem>)}</SelectContent>
              </Select> : <strong title={label}>{label ?? 'Loading…'}</strong>}
              {clip === null ? <span>This clip can no longer be posted.</span> : detail && <span>{detail}</span>}
            </div>
          </Card>
          <div className="post-accounts">
            <div className="post-accounts-head"><h3>Accounts</h3><span>{picked.length} selected</span></div>
            {!platforms || !accounts ? <p className="post-note" role="status">Loading your accounts…</p> : platforms.map(entry => {
              const own = accounts.filter(account => account.platform === entry.platform);
              return <div key={entry.platform} className="post-platform">
                <div className="post-platform-head"><PlatformIcon platform={entry.platform} /><span>{PLATFORM_NAMES[entry.platform]}</span></div>
                {own.map(account => {
                  const expired = account.status !== 'connected', disabled = expired || !entry.live;
                  return <label key={account.id} className="post-account" data-disabled={disabled || undefined}>
                    <Checkbox disabled={disabled} checked={!disabled && chosen.has(account.id)} onCheckedChange={checked => setChosen(previous => { const next = new Set(previous); if (checked === true) next.add(account.id); else next.delete(account.id); return next; })} />
                    <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} /><span className="post-account-name">@{account.username}</span>{expired && <small>Reconnect needed</small>}
                  </label>;
                })}
                {!own.length && <p className="post-note">No accounts connected yet.</p>}
              </div>;
            })}
            {platforms && accounts && live.size > 0 && !usable.length && <Button asChild variant="soft" size="sm" className="post-connect"><Link href="/accounts">Connect an account</Link></Button>}
          </div>
        </div>
        <div className="post-dialog-main">
          <div className="post-field">
            <label htmlFor="post-caption">Caption</label>
            <Textarea id="post-caption" rows={4} maxLength={CAPTION_LIMIT} value={caption} onChange={event => setCaption(event.target.value)} />
            <div className="post-field-note">
              <span>Used for all accounts.{custom > 0 && ` ${custom} ${custom === 1 ? 'account has its own caption' : 'accounts have their own caption'}.`}</span>
              <Button variant="ghost" size="sm" className="post-quiet" disabled={!picked.length} aria-expanded={perAccount} onClick={() => setPerAccount(open => !open)}><Pencil aria-hidden="true" />Edit per account</Button>
            </div>
            {perAccount && picked.map(account => <div key={account.id} className="post-own">
              <label htmlFor={`post-caption-${account.id}`}><PlatformIcon platform={account.platform} />@{account.username}</label>
              <Textarea id={`post-caption-${account.id}`} rows={2} maxLength={CAPTION_LIMIT} placeholder="Leave empty to use the caption above" value={overrides[account.id] ?? ''} onChange={event => setOverrides(previous => ({ ...previous, [account.id]: event.target.value }))} />
            </div>)}
          </div>
          {titled && <div className="post-field">
            <label htmlFor="post-title">Title <small>YouTube</small></label>
            <Input id="post-title" maxLength={TITLE_LIMIT} value={title} onChange={event => setTitle(event.target.value)} />
          </div>}
          {/* YouTube videos can only be posted public, so the dialog says it instead of offering a choice. */}
          {titled && <p className="post-note">{YOUTUBE_VISIBILITY_NOTE}</p>}
          {onTikTok.map(account => <TikTokPostSettings key={account.id} username={account.username} creator={creators[account.id]} choice={tiktok[account.id] ?? NO_TIKTOK_CHOICE} durationSeconds={clip?.durationSeconds ?? null}
            onChange={next => setTiktok(previous => ({ ...previous, [account.id]: next }))} onRetry={() => loadCreator(account.id)} />)}
          <div className="post-field">
            <label htmlFor="post-when">Schedule <small>Optional</small></label>
            <div className="post-when" data-empty={!when || undefined}>
              <CalendarDays aria-hidden="true" />
              <Input id="post-when" type="datetime-local" min={localInputValue(Date.now())} value={when} onChange={event => { const next = event.target.value; setWhen(next); setError(next && new Date(next).getTime() <= Date.now() ? 'Pick a time in the future.' : ''); }} />
              <span aria-hidden="true">Pick a date and time</span>
            </div>
          </div>
        </div>
      </div>
      <div className="post-dialog-foot">
        {onTikTok.length > 0 && <TikTokConsent branded={onTikTok.some(account => tiktok[account.id]?.disclose && tiktok[account.id]?.branded)} />}
        {error ? <p className="dash-error" role="alert">{error}</p> : blocked ? <p className="post-note post-blocked" role="status">{blocked}</p> : timeline && <p className="post-note post-blocked">Revline exports this video first, then {schedule ? 'schedules' : 'posts'} it.</p>}
        {/* A disabled button shows no hint of its own, so the reason sits on the wrapper as well as in the line beside it. */}
        <span className="post-dialog-actions" title={blocked || undefined}>
          <Button variant="primary" disabled={busy || !picked.length || !clip || !!blocked} onClick={() => void submit()}>{schedule ? busy ? 'Scheduling…' : 'Schedule' : busy ? 'Posting…' : 'Post now'}</Button>
        </span>
      </div>
    </>}
  </DialogContent></Dialog>;
}
