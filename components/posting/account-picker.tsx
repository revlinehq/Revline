'use client';
// Who a post goes to: an account group, then single accounts added or removed for this post only. Shared by every
// place that posts (the Post dialog, the editor's Post menu, the assistant's confirmation card) so they all offer
// the user's groups the same way. Groups are managed on the Connected accounts page (/accounts).
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useConvexAuth, useQuery } from 'convex/react';
import { Check, ChevronDown, ChevronsUpDown, ListChecks, Plus, Settings2, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AccountAvatar, PlatformIcon } from './account-avatar';
import './account-picker.css';

export type PickerAccount = { id: Id<'postingAccounts'>; platform: PostingPlatform; username: string; avatarUrl: string | null; status: string };
export type AccountGroup = { id: Id<'postingGroups'>; name: string; isDefault: boolean; accountIds: Id<'postingAccounts'>[] };

/** The signed-in owner's account groups; undefined while they load. */
export function useAccountGroups() {
  const { isAuthenticated } = useConvexAuth();
  return useQuery(api.postingGroups.list, isAuthenticated ? {} : 'skip');
}

export const accountsLabel = (count: number) => `${count} ${count === 1 ? 'account' : 'accounts'}`;

/** Up to three of a group's accounts as overlapping avatars. */
export function GroupAvatars({ accounts }: { accounts: PickerAccount[] }) {
  return <span className="group-avatars" aria-hidden="true">{accounts.slice(0, 3).map(account => <AccountAvatar key={account.id} username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} />)}</span>;
}

/**
 * The picked group and accounts. `chosen` is what is posted to; `usable` says which accounts can be picked right now
 * (connected, platform live). Picking a group ticks its usable accounts; the others are listed as skipped with a
 * Reconnect link, and the post still goes to the rest. `groupId`: the group to start on (the assistant's); without
 * one, the user's default group is picked once, if nothing is chosen yet. `variant="card"`: the confirmation card's
 * compact form, "Posting to <group> · N accounts", which expands to tick or untick accounts.
 */
export function AccountPicker({ accounts, usable, chosen, onChange, groupId: startGroup, variant = 'pills', skippedIds = [], disabled = false, onGroupChange }: {
  accounts: PickerAccount[]; usable: (account: PickerAccount) => boolean; chosen: Set<string>; onChange: (next: Set<string>) => void;
  groupId?: Id<'postingGroups'> | null; variant?: 'pills' | 'card'; skippedIds?: string[]; disabled?: boolean;
  onGroupChange?: (groupId: Id<'postingGroups'> | null) => void;
}) {
  const groups = useAccountGroups();
  const [groupId, setGroupId] = useState<Id<'postingGroups'> | null>(startGroup ?? null), [open, setOpen] = useState(false);
  const started = useRef(startGroup !== undefined || chosen.size > 0);
  const byId = new Map(accounts.map(account => [account.id as string, account]));
  const group = groups?.find(item => item.id === groupId) ?? null;
  const members = group ? group.accountIds.map(id => byId.get(id)).filter((account): account is PickerAccount => !!account) : [];
  // Accounts that need reconnecting: the group's, skipped from this post (on the card, also the ones the assistant left out); without a group, every one, so the Reconnect path stays in view.
  const reconnect = (account: PickerAccount) => account.status === 'needs_reconnect';
  const skipped = group ? members.filter(account => !usable(account) && reconnect(account)) : accounts.filter(account => reconnect(account) || skippedIds.includes(account.id));
  const picked = accounts.filter(account => chosen.has(account.id) && usable(account));

  function pickGroup(next: AccountGroup | null) {
    started.current = true;
    setGroupId(next?.id ?? null); onGroupChange?.(next?.id ?? null);
    if (next) onChange(new Set(next.accountIds.filter(id => { const account = byId.get(id); return !!account && usable(account); })));
    else setOpen(true);
  }
  // The default group, once, when the user has not picked anything yet.
  useEffect(() => {
    if (started.current || !groups || !accounts.length) return;
    started.current = true;
    const fallback = groups.find(item => item.isDefault);
    if (fallback) pickGroup(fallback);
  }, [groups, accounts.length]);
  function toggle(accountId: string, on: boolean) {
    // The parent now knows the picks are the user's own, so a remount does not apply the default group over them.
    if (!started.current) onGroupChange?.(groupId);
    started.current = true;
    const next = new Set(chosen);
    if (on) next.add(accountId); else next.delete(accountId);
    onChange(next);
  }

  // "2 of 3 accounts" when some of the group's accounts were removed; a plain count once accounts outside the group were added.
  const ready = members.filter(usable), inGroup = picked.filter(account => members.includes(account)).length;
  const summary = !group ? picked.length ? `${picked.length} selected` : 'None selected' : inGroup === picked.length && inGroup < ready.length ? `${inGroup} of ${accountsLabel(ready.length)}` : accountsLabel(picked.length);
  const menu = <DropdownMenuContent align={variant === 'card' ? 'end' : 'start'} className="dash-menu group-menu">
    {groups?.map(item => {
      const own = item.accountIds.map(id => byId.get(id)).filter((account): account is PickerAccount => !!account);
      return <DropdownMenuItem key={item.id} onSelect={() => pickGroup(item)}>
        <GroupAvatars accounts={own} /><span className="group-menu-name">{item.name}</span><small>{own.length}</small>
        {item.id === groupId && <Check className="group-menu-check" aria-label="Picked" />}
      </DropdownMenuItem>;
    })}
    {!!groups?.length && <DropdownMenuSeparator />}
    <DropdownMenuItem onSelect={() => pickGroup(null)}><ListChecks aria-hidden="true" /><span>{variant === 'card' ? 'Pick accounts…' : 'Pick accounts one by one'}</span></DropdownMenuItem>
    <DropdownMenuItem asChild><Link href="/accounts"><Settings2 aria-hidden="true" /><span>{groups?.length ? 'Manage groups' : 'Make a group'}</span></Link></DropdownMenuItem>
  </DropdownMenuContent>;
  const skippedNote = skipped.length > 0 && <p className="account-picker-skipped" role="status">
    {skipped.length === 1 ? '1 account needs' : `${skipped.length} accounts need`} reconnecting{group || skippedIds.length ? ', skipped' : ''}: {skipped.map(account => `@${account.username}`).join(', ')}. <Link href="/accounts">Reconnect</Link>
  </p>;

  if (variant === 'card') {
    // Rows: the group's accounts and anything ticked, or every usable account once the user picks one by one.
    const rows = group ? [...members.filter(usable), ...picked.filter(account => !members.includes(account))] : accounts.filter(account => usable(account) || chosen.has(account.id));
    return <div className="account-picker" data-variant="card">
      <div className="account-picker-head">
        <span className="account-picker-label">Posting to</span>
        <Button type="button" variant="ghost" size="sm" className="account-picker-expand" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <strong>{group?.name ?? 'Accounts'}</strong><span>· {summary}</span><ChevronDown aria-hidden="true" data-open={open || undefined} />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button type="button" variant="soft" size="sm" className="account-picker-change" disabled={disabled}>Change<ChevronDown aria-hidden="true" /></Button></DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </div>
      {open ? <ul className="account-picker-rows">{rows.map(account => <li key={account.id}><label>
        <Checkbox disabled={disabled || !usable(account)} checked={chosen.has(account.id)} onCheckedChange={checked => toggle(account.id, checked === true)} />
        <PlatformIcon platform={account.platform} /><span className="account-picker-platform">{PLATFORM_NAMES[account.platform]}</span><span className="account-picker-handle">@{account.username}</span>
      </label></li>)}</ul> : <ul className="account-picker-rows">{picked.map(account => <li key={account.id}>
        <PlatformIcon platform={account.platform} /><span className="account-picker-platform">{PLATFORM_NAMES[account.platform]}</span><span className="account-picker-handle">@{account.username}</span>
      </li>)}</ul>}
      {skippedNote}
    </div>;
  }

  const rest = accounts.filter(account => !chosen.has(account.id) || !usable(account));
  return <div className="account-picker" data-variant="pills">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="account-picker-trigger" disabled={disabled} aria-label="Post to">
        {group ? <><GroupAvatars accounts={members} /><span className="account-picker-name">{group.name}</span></> : <span className="account-picker-name">Pick accounts</span>}
        <small>{summary}</small><ChevronsUpDown aria-hidden="true" />
      </Button></DropdownMenuTrigger>
      {menu}
    </DropdownMenu>
    <div className="account-pills">
      {picked.map(account => <span key={account.id} className="account-pill">
        <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} /><span>@{account.username}</span>
        <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Remove @${account.username} from this post`} onClick={() => toggle(account.id, false)}><X /></Button>
      </span>)}
      {rest.length > 0 && <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" className="account-pill account-pill-add" disabled={disabled}><Plus aria-hidden="true" />Account</Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="dash-menu group-menu">{rest.map(account => <DropdownMenuItem key={account.id} disabled={!usable(account)} onSelect={() => toggle(account.id, true)}>
          <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} /><span className="group-menu-name">@{account.username}</span><small>{usable(account) ? PLATFORM_NAMES[account.platform] : reconnect(account) ? 'Reconnect needed' : 'Unavailable'}</small>
        </DropdownMenuItem>)}</DropdownMenuContent>
      </DropdownMenu>}
    </div>
    {skippedNote}
    {group && <p className="account-picker-note">Removing an account only changes this post.</p>}
  </div>;
}
