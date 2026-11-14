'use client';
// Account groups on the Connected accounts page, in two panes: the groups on the left (on a phone, a row of groups
// above), and on the right every connected account with a tick for "in this group". The right pane also renames,
// stars as default, duplicates and deletes the picked group, and reconnects or disconnects accounts. Groups are
// picked wherever accounts are picked when posting (account-picker.tsx).
import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { CircleAlert, CircleCheck, Copy, Ellipsis, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { PostingPlatform } from '@/lib/posting/adapter';
import { PLATFORM_NAMES, POSTING_PLATFORMS } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AccountAvatar, PlatformIcon } from './account-avatar';
import { accountsLabel, GroupAvatars, useAccountGroups, type AccountGroup } from './account-picker';
import './account-groups.css';

export type PaneAccount = { id: Id<'postingAccounts'>; platform: PostingPlatform; username: string; avatarUrl: string | null; status: string; error: string | null };
type OnError = (message: string) => void;
/** What the page lends the panes: connecting, reconnecting and disconnecting, which also run from its header. */
export type AccountActions = {
  live: (platform: PostingPlatform) => boolean; canConnect: (platform: PostingPlatform) => boolean; busy: boolean;
  connect: (platform: PostingPlatform, accountId?: Id<'postingAccounts'>) => void; disconnect: (accountId: Id<'postingAccounts'>) => void;
};

/** The default group's star, next to its name: filled on the default (the assistant posts to it when no accounts are named), outlined on the others. Clicking toggles it. */
function DefaultStar({ group, onToggle }: { group: AccountGroup; onToggle: () => void }) {
  return <Tooltip>
    <TooltipTrigger asChild><Button data-slot="button" variant="ghost" size="icon" className="account-group-star" data-on={group.isDefault || undefined} aria-pressed={group.isDefault}
      aria-label={group.isDefault ? `${group.name} is your default group` : `Make ${group.name} your default group`} onClick={onToggle}><Star /></Button></TooltipTrigger>
    <TooltipContent className="account-group-tip">{group.isDefault ? 'Default' : 'Make default'}</TooltipContent>
  </Tooltip>;
}

/** The picked group's name, edited in place: Enter or leaving the field saves, Escape puts the old name back. */
function GroupName({ group, focus, onError }: { group: AccountGroup; focus: boolean; onError: OnError }) {
  const rename = useMutation(api.postingGroups.rename);
  const [name, setName] = useState(group.name), field = useRef<HTMLInputElement>(null), cancelled = useRef(false);
  // A rename from elsewhere (another tab, the assistant) shows up, except while the user is typing in the field.
  useEffect(() => { if (document.activeElement !== field.current) setName(group.name); }, [group.name]);
  useEffect(() => { if (focus) { field.current?.focus(); field.current?.select(); } }, [focus]);
  async function save() {
    if (cancelled.current) { cancelled.current = false; return; }
    if (name.trim() === group.name) { setName(group.name); return; }
    onError('');
    try { await rename({ groupId: group.id, name }); }
    catch (reason) { onError(userError(reason, 'Could not rename this group.')); setName(group.name); }
  }
  return <form className="group-pane-name" onSubmit={event => { event.preventDefault(); field.current?.blur(); }}>
    <Input ref={field} aria-label="Group name" maxLength={40} value={name} onChange={event => setName(event.target.value)} onBlur={() => void save()}
      onKeyDown={event => { if (event.key === 'Escape') { cancelled.current = true; setName(group.name); event.currentTarget.blur(); } }} />
    <Pencil aria-hidden="true" onClick={() => field.current?.focus()} />
  </form>;
}

/** A still copy of the panes while the groups and accounts load. */
export function PanesSkeleton() {
  return <Card variant="dash" className="group-panes" role="status" aria-label="Loading your accounts">
    <div className="group-list"><Skeleton className="h-3 w-14" />{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full rounded-lg" />)}</div>
    <div className="group-pane"><Skeleton className="h-10 w-64 rounded-md" />{Array.from({ length: 4 }, (_, index) => <div key={index} className="group-pane-row"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-4 w-36" /></div>)}</div>
  </Card>;
}

export function GroupPanes({ accounts, actions }: { accounts: PaneAccount[]; actions: AccountActions }) {
  const groups = useAccountGroups();
  // Its own error line, so a group action never clears a connect error the page is showing.
  const [error, onError] = useState('');
  const create = useMutation(api.postingGroups.create), setMember = useMutation(api.postingGroups.setMember), duplicate = useMutation(api.postingGroups.duplicate);
  const remove = useMutation(api.postingGroups.remove), setDefault = useMutation(api.postingGroups.setDefault);
  const [picked, setPicked] = useState<Id<'postingGroups'> | null>(null), [naming, setNaming] = useState<Id<'postingGroups'> | null>(null), [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false);
  if (!groups) return <PanesSkeleton />;
  // The picked group, else the default, else the first; a deleted one falls back the same way.
  const group = groups.find(item => item.id === picked) ?? groups.find(item => item.isDefault) ?? groups[0] ?? null;
  const order = (platform: PostingPlatform) => POSTING_PLATFORMS.indexOf(platform);
  const sorted = [...accounts].sort((a, b) => order(a.platform) - order(b.platform));
  const byId = new Map(accounts.map(account => [account.id as string, account]));
  async function act(work: () => Promise<unknown>, fallback: string) {
    onError('');
    try { await work(); } catch (reason) { onError(userError(reason, fallback)); }
  }
  async function newGroup() {
    if (creating) return;
    setCreating(true); onError('');
    try { const groupId = await create({}); setPicked(groupId); setNaming(groupId); }
    catch (reason) { onError(userError(reason, 'Could not create a group.')); }
    finally { setCreating(false); }
  }
  return <Card variant="dash" className="group-panes">
    <nav className="group-list" aria-label="Groups">
      {groups.length > 0 && <span className="group-list-label">Groups</span>}
      {groups.map(item => {
        const members = item.accountIds.map(id => byId.get(id)).filter((account): account is PaneAccount => !!account);
        return <Button key={item.id} variant="ghost" className="group-list-item" aria-current={item.id === group?.id || undefined} onClick={() => { setPicked(item.id); setNaming(null); setConfirming(false); }}>
          <span className="group-list-name"><span className="group-list-title"><span>{item.name}</span>{item.isDefault && <Star className="group-list-star" aria-label="Default group" />}</span><small>{accountsLabel(members.length)}</small></span>
          <GroupAvatars accounts={members} />
        </Button>;
      })}
      <Button variant="ghost" className="group-list-new" disabled={creating} onClick={() => void newGroup()}><Plus />New group</Button>
    </nav>
    <section className="group-pane" aria-label={group ? group.name : 'All accounts'}>
      {error && <p className="dash-error" role="alert">{error}</p>}
      <div className="group-pane-head">
        {group ? <>
          <GroupName key={group.id} group={group} focus={naming === group.id} onError={onError} />
          <DefaultStar group={group} onToggle={() => void act(() => setDefault({ groupId: group.isDefault ? null : group.id }), 'Could not change the default group.')} />
          <div className="group-pane-actions">
            {/* Deleting cannot be undone, so the first click asks and the second deletes; moving away cancels. */}
            <Button variant="ghost" className="group-pane-delete" data-confirm={confirming || undefined} onBlur={() => setConfirming(false)}
              onClick={() => { if (!confirming) { setConfirming(true); return; } setConfirming(false); void act(() => remove({ groupId: group.id }), 'Could not delete this group.'); }}><Trash2 />{confirming ? 'Delete for good?' : 'Delete group'}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button data-slot="button" variant="ghost" size="icon" className="dash-more" aria-label={`More for ${group.name}`}><Ellipsis /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dash-menu group-menu">
                <DropdownMenuItem onSelect={() => void act(async () => { setPicked(await duplicate({ groupId: group.id })); }, 'Could not duplicate this group.')}><Copy aria-hidden="true" /><span>Duplicate</span></DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </> : <h2 className="group-pane-title">All accounts</h2>}
      </div>
      {sorted.map(account => {
        const expired = account.status === 'needs_reconnect', member = !!group?.accountIds.includes(account.id);
        const elsewhere = groups.filter(item => item.id !== group?.id && item.accountIds.includes(account.id));
        return <div key={account.id} className="group-pane-row" data-expired={expired || undefined}>
          <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} />
          <span className="dash-list-row-name">@{account.username}<small>{expired && account.error && !/expired/i.test(account.error) ? account.error : PLATFORM_NAMES[account.platform]}</small></span>
          {expired && <>
            <span className="dash-list-state" data-attention=""><CircleAlert aria-hidden="true" /><span className="account-state-label">{/expired/i.test(account.error ?? 'expired') ? 'Sign-in expired' : 'Reconnect needed'}</span></span>
            <Button variant="primary" size="sm" className="group-pane-reconnect" disabled={!actions.live(account.platform) || actions.busy} aria-label={`Reconnect @${account.username}`} onClick={() => actions.connect(account.platform, account.id)}>Reconnect</Button>
          </>}
          {!group && !expired && <span className="dash-list-state"><CircleCheck aria-hidden="true" /><span className="account-state-label">Connected</span></span>}
          {group && elsewhere.length > 0 && <span className="group-chip" title={elsewhere.map(item => item.name).join(', ')}>In {elsewhere[0].name}{elsewhere.length > 1 ? ` +${elsewhere.length - 1}` : ''}</span>}
          {group && <Checkbox checked={member} aria-label={`@${account.username} (${PLATFORM_NAMES[account.platform]}) in ${group.name}`}
            onCheckedChange={next => void act(() => setMember({ groupId: group.id, accountId: account.id, member: next === true }), member ? 'Could not remove this account.' : 'Could not add this account.')} />}
          {/* Disconnecting ends the account everywhere; leaving it unticked only keeps it out of this group. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button data-slot="button" variant="ghost" size="icon" className="dash-more" aria-label={`More for @${account.username}`}><Ellipsis /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="dash-menu">
              {!expired && <DropdownMenuItem disabled={!actions.live(account.platform) || actions.busy} onSelect={() => actions.connect(account.platform, account.id)}>Reconnect</DropdownMenuItem>}
              <DropdownMenuItem disabled={actions.busy} onSelect={() => actions.disconnect(account.id)}>Disconnect</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>;
      })}
      {!sorted.length && <p className="group-pane-note">No accounts connected yet.</p>}
      {/* With no group yet the pane is the account list, so it offers connecting another per platform; otherwise Connect account in the header does. */}
      {!groups.length && <div className="group-pane-connect">{POSTING_PLATFORMS.map(platform => <Button key={platform} variant="ghost" size="sm" className="account-connect-button" disabled={!actions.canConnect(platform)} aria-label={`Connect a ${PLATFORM_NAMES[platform]} account`} onClick={() => actions.connect(platform)}>
        <Plus /><PlatformIcon platform={platform} />{PLATFORM_NAMES[platform]}
      </Button>)}</div>}
    </section>
  </Card>;
}
