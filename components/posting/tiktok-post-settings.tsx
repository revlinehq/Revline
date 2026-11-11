'use client';
// The part of the Post dialog TikTok's Direct Post rules prescribe for each TikTok account a clip goes to:
// https://developers.tiktok.com/doc/content-sharing-guidelines ("Required UX Implementation in Your App").
// The account's nickname, a "who can view" choice from that account's own options with nothing pre-selected,
// interaction checkboxes that start unticked, the commercial content disclosure, and the consent line.
import { useId } from 'react';
import type { FunctionReturnType } from 'convex/server';
import type { api } from '@/convex/_generated/api';
import type { TikTokPrivacyLevel } from '@/lib/posting/platforms/tiktok/settings';
import { TIKTOK_VISIBILITY_NAMES } from '@/lib/posting/visibility';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { PlatformIcon } from './account-avatar';

/** The account's posting settings as TikTok reports them now, or why it cannot post. Undefined while loading. */
export type TikTokCreator = FunctionReturnType<typeof api.postingActions.tiktokCreator>;
export type TikTokChoice = { privacy?: TikTokPrivacyLevel; comment: boolean; duet: boolean; stitch: boolean; disclose: boolean; yourBrand: boolean; branded: boolean };
/** Nothing chosen: TikTok requires every one of these to be the user's own action. */
export const NO_TIKTOK_CHOICE: TikTokChoice = { comment: false, duet: false, stitch: false, disclose: false, yourBrand: false, branded: false };

const NEEDS_DISCLOSURE = 'You need to indicate if your content promotes yourself, a third party, or both.';
const BRANDED_NOT_PRIVATE = 'Branded content visibility cannot be set to private.';

/** Why this account's post cannot be sent yet, as one line beside the post buttons. Empty when it can. The account's own block shows TikTok's full reason. */
export function tiktokProblem(username: string, creator: TikTokCreator | undefined, choice: TikTokChoice, durationSeconds: number | null): string {
  if (!creator) return `Loading TikTok’s settings for @${username}…`;
  if (!creator.ok) return `@${username} cannot post to TikTok right now. Untick it to post to the other accounts.`;
  if (durationSeconds !== null && durationSeconds > creator.maxDurationSeconds) return `This clip is too long for @${username} on TikTok. Untick it to post to the other accounts.`;
  if (!choice.privacy || !creator.privacyLevels.includes(choice.privacy)) return `Choose who can view the post on @${username}.`;
  if (choice.disclose && !choice.yourBrand && !choice.branded) return NEEDS_DISCLOSURE;
  if (choice.disclose && choice.branded && choice.privacy === 'SELF_ONLY') return BRANDED_NOT_PRIVATE;
  return '';
}

/** The choice as `posting.createBatch` stores it. An interaction the account has switched off is never sent as allowed. */
export function tiktokTarget(creator: TikTokCreator | undefined, choice: TikTokChoice) {
  const off = creator?.ok ? creator : { commentDisabled: true, duetDisabled: true, stitchDisabled: true };
  return {
    ...(choice.privacy ? { visibility: choice.privacy } : {}),
    tiktok: {
      allowComment: choice.comment && !off.commentDisabled, allowDuet: choice.duet && !off.duetDisabled, allowStitch: choice.stitch && !off.stitchDisabled,
      yourBrand: choice.disclose && choice.yourBrand, brandedContent: choice.disclose && choice.branded,
    },
  };
}

export function TikTokPostSettings({ username, creator, choice, durationSeconds, onChange, onRetry }: {
  username: string; creator: TikTokCreator | undefined; choice: TikTokChoice; durationSeconds: number | null;
  onChange: (next: TikTokChoice) => void;
  /** Ask TikTok for the account's settings again. */
  onRetry: () => void;
}) {
  const id = useId(), set = (patch: Partial<TikTokChoice>) => onChange({ ...choice, ...patch });
  const branded = choice.disclose && choice.branded, tooLong = creator?.ok && durationSeconds !== null && durationSeconds > creator.maxDurationSeconds;
  const interactions = creator?.ok ? [
    { key: 'comment' as const, name: 'Comment', disabled: creator.commentDisabled },
    { key: 'duet' as const, name: 'Duet', disabled: creator.duetDisabled },
    { key: 'stitch' as const, name: 'Stitch', disabled: creator.stitchDisabled },
  ] : [];
  return <div className="post-field post-tiktok" role="group" aria-label={`TikTok settings for @${username}`}>
    <span className="post-tiktok-head"><PlatformIcon platform="tiktok" />TikTok<small>@{username}</small></span>
    {!creator ? <p className="post-note" role="status">Loading this account’s TikTok settings…</p> : !creator.ok ? <>
      <p className="dash-error" role="alert">{creator.error}</p>
      <Button variant="soft" size="sm" className="post-connect" onClick={onRetry}>Try again</Button>
    </> : <>
      <p className="post-note">Posting as <strong>{creator.nickname || `@${creator.username || username}`}</strong></p>
      {tooLong && <p className="dash-error" role="alert">This account can post videos up to {creator.maxDurationSeconds} seconds; this clip is {Math.ceil(durationSeconds)} seconds.</p>}
      <div className="post-tiktok-row">
        <label htmlFor={`${id}-privacy`}>Who can view this post</label>
        <Select value={choice.privacy ?? ''} onValueChange={value => set({ privacy: value as TikTokPrivacyLevel })}>
          <SelectTrigger id={`${id}-privacy`} className="post-select-trigger"><SelectValue placeholder="Choose" /></SelectTrigger>
          <SelectContent className="post-select">{creator.privacyLevels.map(level => {
            // Branded content cannot be private.
            const blocked = branded && level === 'SELF_ONLY';
            return <SelectItem key={level} value={level} disabled={blocked} title={blocked ? BRANDED_NOT_PRIVATE : undefined}>{TIKTOK_VISIBILITY_NAMES[level]}</SelectItem>;
          })}</SelectContent>
        </Select>
      </div>
      <div className="post-tiktok-row">
        <span>Allow users to</span>
        <div className="post-checks">{interactions.map(item => <label key={item.key} data-disabled={item.disabled || undefined} title={item.disabled ? `${item.name} is switched off in this account’s TikTok settings.` : undefined}>
          <Checkbox disabled={item.disabled} checked={!item.disabled && choice[item.key]} onCheckedChange={checked => set({ [item.key]: checked === true })} />{item.name}
        </label>)}</div>
      </div>
      <div className="post-tiktok-row post-tiktok-disclose">
        <label htmlFor={`${id}-disclose`}>Disclose video content<small>Turn on if this video promotes you, a brand, a product or a service.</small></label>
        <Switch id={`${id}-disclose`} checked={choice.disclose} onCheckedChange={disclose => set({ disclose })} />
      </div>
      {choice.disclose && <div className="post-checks post-checks-stacked">
        <label><Checkbox checked={choice.yourBrand} onCheckedChange={checked => set({ yourBrand: checked === true })} />Your brand<small>You are promoting yourself or your own business.</small></label>
        <label data-disabled={choice.privacy === 'SELF_ONLY' && !choice.branded || undefined} title={choice.privacy === 'SELF_ONLY' ? BRANDED_NOT_PRIVATE : undefined}>
          <Checkbox disabled={choice.privacy === 'SELF_ONLY' && !choice.branded} checked={choice.branded} onCheckedChange={checked => set({ branded: checked === true })} />Branded content<small>You are promoting another brand or a third party.</small>
        </label>
        {choice.privacy === 'SELF_ONLY' && <p className="post-note">{BRANDED_NOT_PRIVATE}</p>}
        <p className="post-note" role="status">{choice.branded ? 'Your video will be labeled as “Paid partnership”.' : choice.yourBrand ? 'Your video will be labeled as “Promotional content”.' : NEEDS_DISCLOSURE}</p>
      </div>}
      <p className="post-note">After you post, TikTok can take a few minutes to process the video before it shows on the profile.</p>
    </>}
  </div>;
}

/** The declaration TikTok requires before the publish button. `branded`: a picked account discloses branded content. */
export function TikTokConsent({ branded }: { branded: boolean }) {
  const music = <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>;
  return <p className="post-note post-consent">By posting, you agree to TikTok’s {branded && <><a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer">Branded Content Policy</a> and </>}{music}.</p>;
}
