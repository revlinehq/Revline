'use client';
import { useState } from 'react';
import Link from 'next/link';
import { DashboardMenuButton } from '@/components/dashboard/dashboard-navbar';
import type { FunctionReturnType } from 'convex/server';
import { ChevronLeft, ChevronRight, Plus, RotateCw, X } from 'lucide-react';
import type { api } from '@/convex/_generated/api';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { PLATFORM_NAMES, POSTING_PLATFORMS } from '@/lib/posting/platform-names';
import { ProjectCover } from '@/components/workspace/project-cover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PlatformIcon } from './account-avatar';
import { localInputValue } from './post-time';
import type { ClipPost, Exporting, Row } from './post-rows';

type Account = FunctionReturnType<typeof api.posting.accounts>[number];

// ---------------------------------------------------------------- days and weeks, in the viewer's time zone

function startOfDay(time: number) { const day = new Date(time); day.setHours(0, 0, 0, 0); return day.getTime(); }
function addDays(time: number, days: number) { const day = new Date(time); day.setDate(day.getDate() + days); return day.getTime(); }
/** Midnight on the Monday of the week `time` falls in. */
export function mondayOf(time: number) { const day = startOfDay(time); return addDays(day, -((new Date(day).getDay() + 6) % 7)); }
const clock = (time: number) => new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
/** "Nov 10 – 16", "Oct 27 – Nov 2", with the year when it is not this one. */
function weekRange(monday: number) {
  const first = new Date(monday), last = new Date(addDays(monday, 6)), year = new Date().getFullYear();
  const month = (date: Date) => date.toLocaleDateString(undefined, { month: 'short' });
  const tail = last.getMonth() === first.getMonth() ? `${last.getDate()}` : `${month(last)} ${last.getDate()}`;
  return `${month(first)} ${first.getDate()} – ${tail}${last.getFullYear() !== year ? `, ${last.getFullYear()}` : ''}`;
}
/** Where "Post here" puts a new post: the next whole hour today, 9:00 AM on a later day. */
function postHereTime(day: number) {
  const now = Date.now();
  if (day > now) return new Date(day).setHours(9, 0, 0, 0);
  const next = new Date(now); next.setHours(next.getHours() + 1, 0, 0, 0);
  // Late in the evening the next whole hour is tomorrow: a few minutes from now keeps the post on the day picked.
  return next.getTime() < addDays(day, 1) ? next.getTime() : now + 10 * 60_000;
}

// ---------------------------------------------------------------- header and accounts

/** The page title, week navigation, New post, and the accounts the posts go to. */
export function PostsHeader({ week, accounts, onWeek, onNew }: {
  week: number | null; accounts: Account[] | undefined; onWeek: (week: number) => void; onNew: () => void;
}) {
  return <div className="posts-head">
    <div className="posts-head-row">
      <DashboardMenuButton />
      <h1>Posts</h1>
      {week !== null && <div className="posts-week-nav">
        <Button variant="ghost" size="icon-sm" aria-label="Previous week" onClick={() => onWeek(addDays(week, -7))}><ChevronLeft /></Button>
        <span>{weekRange(week)}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Next week" onClick={() => onWeek(addDays(week, 7))}><ChevronRight /></Button>
        <Button variant="secondary" size="xs" className="posts-today" onClick={() => onWeek(mondayOf(Date.now()))}>Today</Button>
      </div>}
      <Button variant="primary" className="posts-new" onClick={onNew}><Plus aria-hidden="true" />New post</Button>
    </div>
    {accounts && <div className="posts-accounts-row">
      <span className="posts-accounts-label">Posting to</span>
      {POSTING_PLATFORMS.flatMap(platform => {
        const own = accounts.filter(account => account.platform === platform);
        if (!own.length) return [<span key={platform} className="posts-chip" data-state="none">
          <PlatformIcon platform={platform} /><span className="posts-chip-name">{PLATFORM_NAMES[platform]}</span>
          <Button asChild variant="secondary" size="xs" className="posts-chip-action"><Link href="/accounts">Connect</Link></Button>
        </span>];
        return own.map(account => account.status === 'connected'
          ? <span key={account.id} className="posts-chip" data-state="connected" title={`@${account.username} on ${PLATFORM_NAMES[platform]}`}>
            <PlatformIcon platform={platform} /><span className="posts-chip-name">@{account.username}</span>
          </span>
          : <span key={account.id} className="posts-chip" data-state="expired" title={`@${account.username} on ${PLATFORM_NAMES[platform]}: sign-in expired`}>
            <PlatformIcon platform={platform} /><span className="posts-chip-name">@{account.username}</span>
            <Button asChild variant="secondary" size="xs" className="posts-chip-action"><Link href="/accounts">Reconnect</Link></Button>
          </span>);
      })}
    </div>}
  </div>;
}

// ---------------------------------------------------------------- the week

type Item = { key: string; time: number; row?: Row; exporting?: Exporting };
export type CalendarActions = {
  busy: boolean;
  onRetry: (row: Row) => void; onCancel: (row: Row) => void; onReschedule: (row: Row, time: number) => void;
  onCancelExporting: (clip: Exporting) => void; onPostHere: (time: number) => void;
};

/** The week as seven day columns (a list of days on a phone), every post a full card on its day. */
export function PostsCalendar({ week, rows, exporting, ...actions }: { week: number; rows: Row[]; exporting: Exporting[] } & CalendarActions) {
  const items: Item[] = [
    ...rows.map(row => ({ key: row.clip.batchId, time: row.time, row })),
    ...exporting.map(clip => ({ key: clip.id, time: clip.scheduledAt ?? clip.createdAt, exporting: clip })),
  ];
  const today = startOfDay(Date.now()), end = addDays(week, 7);
  const days = Array.from({ length: 7 }, (_, index) => {
    const start = addDays(week, index), next = addDays(week, index + 1);
    return { start, items: items.filter(item => item.time >= start && item.time < next).sort((a, b) => a.time - b.time) };
  });
  const empty = !items.some(item => item.time >= week && item.time < end);
  return <div className="posts-week">
    <div className="posts-week-grid">
      {days.map(day => {
        const date = new Date(day.start), isToday = day.start === today, past = day.start < today;
        return <section key={day.start} className="posts-day" data-today={isToday || undefined} data-empty={!day.items.length || undefined}
          aria-label={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}>
          <div className="posts-day-head">
            <span className="posts-day-name">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
            <span className="posts-day-date">{date.getDate()}</span>
          </div>
          {!day.items.length && !past && <Button variant="ghost" className="posts-post-here" onClick={() => actions.onPostHere(postHereTime(day.start))}><Plus aria-hidden="true" />Post here</Button>}
          {day.items.map(item => item.row ? <PostCard key={item.key} row={item.row} {...actions} /> : <ExportingCard key={item.key} clip={item.exporting!} {...actions} />)}
        </section>;
      })}
    </div>
    {empty && <div className="posts-week-note" role="status">
      <h2>Nothing scheduled yet</h2>
      <p>Pick a clip and a time with New post, or ask the assistant in the editor to post one. Each post lands on its day here.</p>
    </div>}
  </div>;
}

/** The page header's rows, still, until the page takes over: the same heights, so nothing moves. */
export function PostsHeaderSkeleton() {
  return <div className="posts-head">
    <div className="posts-head-row"><DashboardMenuButton /><h1>Posts</h1><Skeleton className="ml-auto h-9 w-[106px] rounded-[8px]" /></div>
    <div className="posts-accounts-row"><Skeleton className="h-8 w-[360px] max-w-full rounded-[8px]" /></div>
  </div>;
}

/** The week's columns, still, while the posts load. */
export function PostsWeekSkeleton() {
  return <div className="posts-week" role="status" aria-label="Loading your posts"><div className="posts-week-grid">
    {Array.from({ length: 7 }, (_, index) => <div key={index} className="posts-day">
      <div className="posts-day-head"><Skeleton className="h-3 w-12" /></div>
      {index % 3 === 1 && <div className="posts-card"><Skeleton className="h-[92px] w-full rounded-[6px]" /><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-1/2" /></div>}
    </div>)}
  </div></div>;
}

type Tone = 'posted' | 'scheduled' | 'failed';
/** Where the thumbnail goes: the live post (a menu when it went out on several accounts), or the clip in the editor. A Library video has no project: it opens the Library. */
type ThumbTarget = { live: ClipPost[]; projectId: string | null };
/** The card's thumbnail with the time it goes out or went out over it; the whole thumbnail is a link. */
function Thumb({ coverUrl, coverKind, time, tone, target }: { coverUrl: string | null; coverKind: 'video' | 'image' | null; time: number; tone: Tone; target: ThumbTarget }) {
  const inside = <>
    <ProjectCover url={coverUrl} kind={coverKind} />
    {/* A posted card shows only its time; a dot marks a scheduled or failed one. */}
    <span className="posts-card-time">{tone !== 'posted' && <span className="posts-dot" data-tone={tone} aria-hidden="true" />}{clock(time)}</span>
  </>;
  const { live } = target;
  if (live.length === 1) return <a className="posts-card-thumb" href={live[0].url!} target="_blank" rel="noopener noreferrer" aria-label={`View on ${PLATFORM_NAMES[live[0].platform]}`}>{inside}</a>;
  if (live.length > 1) return <DropdownMenu>
    <DropdownMenuTrigger asChild><button type="button" className="posts-card-thumb" aria-label="View the post">{inside}</button></DropdownMenuTrigger>
    <ViewMenu live={live} />
  </DropdownMenu>;
  return target.projectId ? <Link className="posts-card-thumb" href={`/editor/${target.projectId}`} aria-label="Open in the editor">{inside}</Link>
    : <Link className="posts-card-thumb" href="/library" aria-label="Open the Library">{inside}</Link>;
}
/** "View on TikTok · @handle", one item per live post. */
function ViewMenu({ live }: { live: ClipPost[] }) {
  return <DropdownMenuContent align="start" className="dash-menu">
    {live.map(post => <DropdownMenuItem key={post.id} asChild><a href={post.url!} target="_blank" rel="noopener noreferrer">View on {PLATFORM_NAMES[post.platform]} · @{post.username}</a></DropdownMenuItem>)}
  </DropdownMenuContent>;
}

/** One platform line: what happened to the post on that account. */
function platformState(post: ClipPost, held: boolean): { text: string; tone: Tone | 'muted' } {
  if (post.status === 'published') return { text: post.views !== null ? `Posted · ${post.views.toLocaleString()} ${post.views === 1 ? 'view' : 'views'}` : 'Posted', tone: 'posted' };
  if (post.status === 'failed') return { text: 'Failed', tone: 'failed' };
  if (held && (post.status === 'scheduled' || post.status === 'processing')) return { text: 'Waiting', tone: 'muted' };
  if (post.status === 'scheduled' && post.attempts === 0) return { text: 'Scheduled', tone: 'muted' };
  return { text: 'Posting', tone: 'muted' };
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>
    <Button variant="secondary" size="icon-sm" className="posts-card-icon" aria-label={label} disabled={disabled} onClick={onClick}>{children}</Button>
  </TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function PostCard({ row, busy, onRetry, onCancel, onReschedule }: { row: Row } & CalendarActions) {
  const { clip } = row, text = clip.caption || clip.label, failed = row.failed.length > 0;
  const tone: Tone = failed ? 'failed' : row.scheduled ? 'scheduled' : 'posted';
  const held = row.scheduled && !row.queued.length;
  const live = row.published.filter(post => post.url);
  // Several accounts on one platform: each line says which account it is.
  const shared = new Set(clip.posts.map(post => post.platform).filter((platform, index, all) => all.indexOf(platform) !== index));
  let actions: React.ReactNode = null;
  if (failed && row.reconnect) actions = <>
    <Button asChild variant="secondary" size="sm" className="posts-card-action"><Link href="/accounts">Reconnect</Link></Button>
    {/* Retry sends the posts whose account is still connected; with none, it waits for the reconnect. */}
    <IconAction label="Retry" disabled={busy || !row.retryable.length} onClick={() => onRetry(row)}><RotateCw /></IconAction>
  </>;
  else if (failed && row.retryable.length) actions = <Button variant="secondary" size="sm" className="posts-card-action" disabled={busy} onClick={() => onRetry(row)}>Retry</Button>;
  else if (row.cancellable.length) actions = <>
    {row.queued.length > 0 && <Reschedule time={row.time} busy={busy} onSave={time => onReschedule(row, time)} />}
    <IconAction label="Cancel post" disabled={busy} onClick={() => onCancel(row)}><X /></IconAction>
  </>;
  // A posted card has no buttons: its thumbnail opens the live post.
  return <article className="posts-card" data-failed={failed || undefined}>
    <Thumb coverUrl={clip.coverUrl} coverKind={clip.coverKind} time={row.time} tone={tone} target={{ live, projectId: clip.projectId }} />
    <p className="posts-card-caption" title={text}>{text}</p>
    <ul className="posts-card-platforms">{clip.posts.map(post => {
      const state = platformState(post, held);
      return <li key={post.id} title={`@${post.username} on ${PLATFORM_NAMES[post.platform]}`}>
        <PlatformIcon platform={post.platform} labelled />
        <span data-tone={state.tone}>{state.text}{shared.has(post.platform) && <span className="posts-card-handle"> · @{post.username}</span>}</span>
      </li>;
    })}</ul>
    {row.reasons.map(reason => <p key={reason} className="posts-card-reason">{reason}</p>)}
    {actions && <div className="posts-card-actions">{actions}</div>}
  </article>;
}

/** Reschedule: a date and time for every post of the clip that has not gone out. */
function Reschedule({ time, busy, onSave }: { time: number; busy: boolean; onSave: (time: number) => void }) {
  const [open, setOpen] = useState(false), [value, setValue] = useState(''), [error, setError] = useState('');
  function save() {
    const next = new Date(value).getTime();
    if (!Number.isFinite(next) || next <= Date.now()) { setError('Pick a time in the future.'); return; }
    onSave(next); setOpen(false);
  }
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setValue(localInputValue(time)); setError(''); } }}>
    <PopoverTrigger asChild><Button variant="secondary" size="sm" className="posts-card-action" disabled={busy}>Reschedule</Button></PopoverTrigger>
    <PopoverContent align="start" className="posts-reschedule">
      <label htmlFor="posts-reschedule-when">New time</label>
      <Input id="posts-reschedule-when" type="datetime-local" min={localInputValue(Date.now())} value={value} onChange={event => { setValue(event.target.value); setError(''); }} />
      {error && <p className="dash-error" role="alert">{error}</p>}
      <div className="posts-reschedule-foot">
        <Button variant="soft" size="sm" onClick={() => setOpen(false)}>Close</Button>
        <Button variant="primary" size="sm" disabled={!value} onClick={save}>Save</Button>
      </div>
    </PopoverContent>
  </Popover>;
}

/** A clip whose export is still running (or failed): its posts do not exist yet. */
function ExportingCard({ clip, busy, onCancelExporting }: { clip: Exporting } & CalendarActions) {
  const text = clip.caption || clip.label, failed = clip.status === 'failed';
  const platforms = [...new Set(clip.accounts.map(account => account.platform))] as PostingPlatform[];
  const state = failed ? 'Export failed' : clip.progress ? `Exporting ${Math.round(clip.progress)}%` : 'Exporting';
  return <article className="posts-card" data-failed={failed || undefined}>
    <Thumb coverUrl={clip.coverUrl} coverKind={clip.coverKind} time={clip.scheduledAt ?? clip.createdAt} tone={failed ? 'failed' : 'scheduled'} target={{ live: [], projectId: clip.projectId }} />
    <p className="posts-card-caption" title={text}>{text}</p>
    <ul className="posts-card-platforms">{platforms.map(platform => <li key={platform}>
      <PlatformIcon platform={platform} labelled /><span data-tone={failed ? 'failed' : 'muted'}>{state}</span>
    </li>)}</ul>
    {failed && <p className="posts-card-reason">{clip.error ?? 'Nothing was posted.'}</p>}
    {!failed && <div className="posts-card-actions"><Button variant="secondary" size="sm" className="posts-card-action" disabled={busy} onClick={() => onCancelExporting(clip)}>Cancel</Button></div>}
  </article>;
}
