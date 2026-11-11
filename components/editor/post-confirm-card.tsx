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
  const confirm = useMutation(api.assistantPosting.confirmProposal), cancel = useMutation(api.assistantPosting.cancelProposal);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  // The query does not re-run as time passes, so the card reads the clock itself to stop offering an expired press.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  if (!proposal) return null;
  const { clips, accounts, scheduledAt } = proposal, status = proposal.status === 'proposed' && proposal.expiresAt <= now ? 'expired' as const : proposal.status;
  const exporting = clips.filter(clip => clip.exports).length, clipWord = clips.length === 1 ? 'this clip' : `${clips.length} clips`;
  // The same words as the Post dialog's main button: "Schedule" once there is a time, otherwise "Post now".
  const label = scheduledAt ? 'Schedule' : 'Post now';
  async function run(change: typeof confirm, fallback: string) {
    if (busy) return;
    setBusy(true); setError('');
    try { await change({ proposalId }); } catch (reason) { setError(userError(reason, fallback)); } finally { setBusy(false); }
  }
  return <FieldSet className="post-confirm-card" data-status={status}>
    <FieldLegend variant="label">{scheduledAt ? `Schedule ${clipWord} for ${when(scheduledAt)}?` : `Post ${clipWord} now?`}</FieldLegend>
    <dl>
      <div><dt>{clips.length === 1 ? 'Clip' : 'Clips'}</dt><dd>{clips.map(clip => <span key={clip.timelineId}>{clip.name}{clip.exports ? ' (exports first)' : ''}</span>)}</dd></div>
      <div><dt>{accounts.length === 1 ? 'Account' : 'Accounts'}</dt><dd>{accounts.map(account => {
        const visibility = isYouTubeVisibility(account.visibility) ? YOUTUBE_VISIBILITY_NAMES[account.visibility] : isTikTokVisibility(account.visibility) ? TIKTOK_VISIBILITY_NAMES[account.visibility] : null;
        const on = Object.entries(TIKTOK_CHOICES).filter(([key]) => account.tiktok?.[key as keyof typeof TIKTOK_CHOICES]).map(([, name]) => name);
        return <span key={account.accountId}>@{account.username} · {PLATFORM_NAMES[account.platform]}{visibility ? ` · ${visibility}` : ''}{on.length ? ` · ${on.join(', ')} on` : ''}</span>;
      })}</dd></div>
      {[...new Map(accounts.map(account => [`${account.title ?? ''}\n${account.caption}`, account])).values()].map(account => <div key={`${account.accountId}-text`}>
        <dt>{accounts.some(other => other.caption !== account.caption || other.title !== account.title) ? `@${account.username}` : 'Caption'}</dt>
        <dd>{account.title && <strong>{account.title}</strong>}<span className="post-confirm-caption">{account.caption || 'No caption'}</span></dd>
      </div>)}
      <div><dt>When</dt><dd><span>{scheduledAt ? when(scheduledAt) : exporting ? 'As soon as the export finishes' : 'Now'}</span></dd></div>
    </dl>
    {status === 'proposed' ? <>
      <FieldDescription>{exporting ? `Revline exports ${exporting === 1 ? 'the clip' : 'them'} with your export settings, then ${scheduledAt ? 'posts at that time' : 'posts'}.` : scheduledAt ? 'Nothing is sent until that time.' : 'This goes out right away.'} A post on TikTok or Instagram cannot be undone from Revline.</FieldDescription>
      <div className="post-confirm-actions">
        <Button type="button" variant="primary" size="sm" disabled={disabled || busy} onClick={() => void run(confirm, 'Could not start this post.')}>{label}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void run(cancel, 'Could not cancel this post.')}>Cancel</Button>
      </div>
    </> : <FieldDescription role="status">
      {status === 'confirmed' ? <>Confirmed. {scheduledAt ? 'Scheduled' : 'On its way'}: follow it on <Link href="/posts">Posts</Link>.</> : status === 'cancelled' ? 'Cancelled. Nothing was posted.' : 'This confirmation expired. Nothing was posted; ask again to post it.'}
    </FieldDescription>}
    {error && <FieldDescription role="alert" data-error>{error}</FieldDescription>}
  </FieldSet>;
}
