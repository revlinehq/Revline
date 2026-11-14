'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { TIKTOK_VISIBILITY_NAMES, YOUTUBE_VISIBILITY_NAMES, isTikTokVisibility, isYouTubeVisibility } from '@/lib/posting/visibility';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AccountPicker } from '@/components/posting/account-picker';
import type { ChatTool } from './chat-types';
import './post-confirm-card.css';

/** The proposal a postVideo or schedulePost step left for the user to confirm; null for any other step. */
export function postProposalOf(step: ChatTool): Id<'postingProposals'> | null {
  const output = step.output;
  if (step.state !== 'done' || !output || (step.name !== 'postVideo' && step.name !== 'schedulePost')) return null;
  return output.awaitingConfirmation === true && typeof output.proposalId === 'string' ? output.proposalId as Id<'postingProposals'> : null;
}

const when = (time: number) => new Date(time).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const TIKTOK_CHOICES = { allowComment: 'comments', allowDuet: 'duet', allowStitch: 'stitch', yourBrand: 'your brand', brandedContent: 'branded content' } as const;

/**
 * What the assistant asked to post, for the user to confirm. Nothing is exported or sent until Post is pressed here:
 * the assistant cannot press it, and the card states exactly which clips go to which accounts, with which caption,
 * who can view them and when.
 */
export function PostConfirmCard({ proposalId, disabled }: { proposalId: Id<'postingProposals'>; disabled: boolean }) {
  const proposal = useQuery(api.assistantPosting.proposal, { proposalId });
  const owned = useQuery(api.posting.accounts, {}), platforms = useQuery(api.posting.platforms, {});
  const confirm = useMutation(api.assistantPosting.confirmProposal), cancel = useMutation(api.assistantPosting.cancelProposal);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // What the user changed on the card before pressing it: the accounts (null: the assistant's), the group, and who can view a TikTok account they added.
  const [chosen, setChosen] = useState<Set<string> | null>(null), [groupId, setGroupId] = useState<Id<'postingGroups'> | null | undefined>(undefined);
  const [views, setViews] = useState<Record<string, string>>({});
  // The query does not re-run as time passes, so the card reads the clock itself to stop offering an expired press.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  if (!proposal) return null;
  const { clips, scheduledAt } = proposal, status = proposal.status === 'proposed' && proposal.expiresAt <= now ? 'expired' as const : proposal.status;
  const live = new Set(platforms?.filter(entry => entry.live).map(entry => entry.platform));
  const proposed = new Set<string>(proposal.accounts.map(account => account.accountId));
  const levels = new Map((proposal.tiktokLevels ?? []).map(entry => [entry.accountId as string, entry.levels]));
  // An account the assistant did not choose can be added when it can post now; a TikTok one only if TikTok said who may view its posts.
  const usable = (account: { id: string; platform: string; status: string }) => account.status === 'connected' && live.has(account.platform as never) && (account.platform !== 'tiktok' || proposed.has(account.id) || !!levels.get(account.id)?.length);
  const picked = chosen ?? proposed;
  const pickable = status === 'proposed' && !!owned && !!platforms;
  // The accounts as they will be posted to: the assistant's, then those the user added (shared caption, no own settings).
  const accounts = pickable && chosen ? [...proposal.accounts.filter(account => chosen.has(account.accountId)), ...owned.filter(account => chosen.has(account.id) && !proposed.has(account.id)).map(account => ({ accountId: account.id, platform: account.platform, username: account.username, caption: proposal.caption ?? proposal.accounts[0]?.caption ?? '', title: proposal.title ?? null, visibility: views[account.id] ?? null, tiktok: null }))] : proposal.accounts;
  const added = accounts.filter(account => account.platform === 'tiktok' && !proposed.has(account.accountId));
  const missing = added.find(account => !views[account.accountId]);
  const detailed = accounts.filter(account => !pickable || (proposed.has(account.accountId) && (account.visibility || account.tiktok)));
  const blocked = !accounts.length ? 'Pick at least one account.' : missing ? `Choose who can view the post on @${missing.username}.` : '';
  const exporting = clips.filter(clip => clip.exports).length, clipWord = clips.length === 1 ? 'this clip' : `${clips.length} clips`;
  // The same words as the Post dialog's main button: "Schedule" once there is a time, otherwise "Post now".
  const label = scheduledAt ? 'Schedule' : 'Post now';
  async function run(change: typeof cancel, fallback: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await change({ proposalId }); } catch (reason) { setError(userError(reason, fallback)); } finally { setBusy(false); }
  }
  async function press() {
    if (busy || blocked) return;
    setBusy(true); setError('');
    try {
      await confirm({
        proposalId, ...(chosen ? { accountIds: accounts.map(account => account.accountId) } : {}), ...(groupId !== undefined ? { groupId } : {}),
        ...(added.length ? { visibility: added.map(account => ({ accountId: account.accountId, visibility: views[account.accountId] as never })) } : {}),
      });
    } catch (reason) { setError(userError(reason, 'Could not start this post.')); } finally { setBusy(false); }
  }
  return <FieldSet className="post-confirm-card" data-status={status}>
    <FieldLegend variant="label">{scheduledAt ? `Schedule ${clipWord} for ${when(scheduledAt)}?` : `Post ${clipWord} now?`}</FieldLegend>
    <dl>
      <div><dt>{clips.length === 1 ? 'Clip' : 'Clips'}</dt><dd>{clips.map(clip => <span key={clip.timelineId}>{clip.name}{clip.exports ? ' (exports first)' : ''}</span>)}</dd></div>
      {pickable && <div className="post-confirm-picker"><AccountPicker variant="card" accounts={owned} usable={usable} chosen={picked} onChange={setChosen} groupId={proposal.groupId ?? null} skippedIds={proposal.skippedAccountIds ?? []} disabled={busy || disabled} onGroupChange={setGroupId} /></div>}
      {added.map(account => <div key={`${account.accountId}-view`}><dt>@{account.username}</dt><dd>
        <Select value={views[account.accountId] ?? ''} onValueChange={value => setViews(previous => ({ ...previous, [account.accountId]: value }))}>
          <SelectTrigger size="sm" aria-label={`Who can view the post on @${account.username}`}><SelectValue placeholder="Who can view it on TikTok" /></SelectTrigger>
          <SelectContent>{(levels.get(account.accountId) ?? []).map(level => <SelectItem key={level} value={level}>{TIKTOK_VISIBILITY_NAMES[level]}</SelectItem>)}</SelectContent>
        </Select>
      </dd></div>)}
      {/* Once the card offers the picker, this row keeps only what the picker does not show: the assistant's per-account settings. */}
      {detailed.length > 0 && <div><dt>{pickable ? 'Settings' : accounts.length === 1 ? 'Account' : 'Accounts'}</dt><dd>{detailed.map(account => {
        const visibility = isYouTubeVisibility(account.visibility) ? YOUTUBE_VISIBILITY_NAMES[account.visibility] : isTikTokVisibility(account.visibility) ? TIKTOK_VISIBILITY_NAMES[account.visibility] : null;
        const on = Object.entries(TIKTOK_CHOICES).filter(([key]) => account.tiktok?.[key as keyof typeof TIKTOK_CHOICES]).map(([, name]) => name);
        return <span key={account.accountId}>@{account.username} · {PLATFORM_NAMES[account.platform]}{visibility ? ` · ${visibility}` : ''}{on.length ? ` · ${on.join(', ')} on` : ''}</span>;
      })}</dd></div>}
      {[...new Map(accounts.map(account => [`${account.title ?? ''}\n${account.caption}`, account])).values()].map(account => <div key={`${account.accountId}-text`}>
        <dt>{accounts.some(other => other.caption !== account.caption || other.title !== account.title) ? `@${account.username}` : 'Caption'}</dt>
        <dd>{account.title && <strong>{account.title}</strong>}<span className="post-confirm-caption">{account.caption || 'No caption'}</span></dd>
      </div>)}
      <div><dt>When</dt><dd><span>{scheduledAt ? when(scheduledAt) : exporting ? 'As soon as the export finishes' : 'Now'}</span></dd></div>
    </dl>
    {status === 'proposed' ? <>
      <FieldDescription>{exporting ? `Revline exports ${exporting === 1 ? 'the clip' : 'them'} with your export settings, then ${scheduledAt ? 'posts at that time' : 'posts'}.` : scheduledAt ? 'Nothing is sent until that time.' : 'This goes out right away.'} A post on TikTok or Instagram cannot be undone from Revline.</FieldDescription>
      <div className="post-confirm-actions">
        <Button type="button" variant="primary" size="sm" disabled={disabled || busy || !!blocked} onClick={() => void press()}>{label}{chosen && accounts.length ? ` to ${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}` : ''}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(cancel, 'Could not cancel this post.')}>Cancel</Button>
      </div>
    </> : <FieldDescription role="status">
      {status === 'confirmed' ? <>Confirmed. {scheduledAt ? 'Scheduled' : 'On its way'}: follow it on <Link href="/posts">Posts</Link>.</> : status === 'cancelled' ? 'Cancelled. Nothing was posted.' : 'This confirmation expired. Nothing was posted; ask again to post it.'}
    </FieldDescription>}
    {status === 'proposed' && blocked && <FieldDescription role="status">{blocked}</FieldDescription>}
    {error && <FieldDescription role="alert" data-error>{error}</FieldDescription>}
  </FieldSet>;
}
