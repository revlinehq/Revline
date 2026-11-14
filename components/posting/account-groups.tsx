'use client';
// Account groups on the Connected accounts page: a card per group with its accounts, Add, and a menu to rename,
// duplicate, star as default or delete it. Picked wherever accounts are picked when posting (account-picker.tsx).
import { useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { Copy, Ellipsis, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { PLATFORM_NAMES } from '@/lib/posting/platform-names';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { AccountAvatar } from './account-avatar';
import { accountsLabel, useAccountGroups, type AccountGroup, type PickerAccount } from './account-picker';
import './account-groups.css';

function GroupCard({ group, accounts, onError }: { group: AccountGroup; accounts: PickerAccount[]; onError: (message: string) => void }) {
  const rename = useMutation(api.postingGroups.rename), setMember = useMutation(api.postingGroups.setMember), duplicate = useMutation(api.postingGroups.duplicate);
  const remove = useMutation(api.postingGroups.remove), setDefault = useMutation(api.postingGroups.setDefault);
  const [naming, setNaming] = useState(false), [name, setName] = useState(group.name);
  // Escape cancels: the blur that follows the field's removal must not save what was typed.
  const cancelled = useRef(false);
  const members = group.accountIds.map(id => accounts.find(account => account.id === id)).filter((account): account is PickerAccount => !!account);
  const others = accounts.filter(account => !group.accountIds.includes(account.id));
  async function act(work: () => Promise<unknown>, fallback: string) {
    onError('');
    try { await work(); } catch (reason) { onError(userError(reason, fallback)); }
  }
  async function saveName() {
    if (cancelled.current || name.trim() === group.name) { setNaming(false); return; }
    onError('');
    try { await rename({ groupId: group.id, name }); setNaming(false); } catch (reason) { onError(userError(reason, 'Could not rename this group.')); }
  }
  return <Card variant="dash" role="region" aria-label={group.name} className="dash-list account-group">
    <div className="dash-list-head">
      {naming ? <form className="account-group-name" onSubmit={event => { event.preventDefault(); void saveName(); }}>
        <Input autoFocus aria-label="Group name" maxLength={40} onFocus={event => event.currentTarget.select()} value={name} onChange={event => setName(event.target.value)} onBlur={() => void saveName()} onKeyDown={event => { if (event.key === 'Escape') { cancelled.current = true; setName(group.name); setNaming(false); } }} />
      </form> : <><h2>{group.name}</h2><span className="dash-list-meta">{accountsLabel(members.length)}</span></>}
      <div className="dash-list-actions">
        <Button variant="ghost" size="icon" className="dash-more account-group-star" data-on={group.isDefault || undefined} aria-pressed={group.isDefault}
          aria-label={group.isDefault ? `${group.name} is your default group` : `Make ${group.name} your default group`} title={group.isDefault ? 'Default group: the assistant posts here when you name no accounts' : 'Make this the default group'}
          onClick={() => void act(() => setDefault({ groupId: group.isDefault ? null : group.id }), 'Could not change the default group.')}><Star /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="soft" size="sm" className="account-group-add" disabled={!others.length}><Plus />Add</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dash-menu group-menu">{others.map(account => <DropdownMenuItem key={account.id} onSelect={() => void act(() => setMember({ groupId: group.id, accountId: account.id, member: true }), 'Could not add this account.')}>
            <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} /><span className="group-menu-name">@{account.username}</span><small>{PLATFORM_NAMES[account.platform]}</small>
          </DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="dash-more" aria-label={`More for ${group.name}`}><Ellipsis /></Button></DropdownMenuTrigger>
          {/* Focus stays where the item put it: back on the trigger it would blur the name field Rename just opened. */}
          <DropdownMenuContent align="end" className="dash-menu group-menu" onCloseAutoFocus={event => event.preventDefault()}>
            <DropdownMenuItem onSelect={() => { cancelled.current = false; setName(group.name); setNaming(true); }}><Pencil aria-hidden="true" /><span>Rename</span></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void act(() => duplicate({ groupId: group.id }), 'Could not duplicate this group.')}><Copy aria-hidden="true" /><span>Duplicate</span></DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void act(() => setDefault({ groupId: group.isDefault ? null : group.id }), 'Could not change the default group.')}><Star aria-hidden="true" /><span>{group.isDefault ? 'Remove as default' : 'Make default'}</span></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="account-group-delete" onSelect={() => void act(() => remove({ groupId: group.id }), 'Could not delete this group.')}><Trash2 aria-hidden="true" /><span>Delete group</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {members.map(account => <div key={account.id} className="dash-list-row">
      <AccountAvatar username={account.username} avatarUrl={account.avatarUrl} platform={account.platform} />
      <span className="dash-list-row-name">@{account.username}<small>{account.status === 'needs_reconnect' ? `${PLATFORM_NAMES[account.platform]} · Reconnect needed` : PLATFORM_NAMES[account.platform]}</small></span>
      <Button variant="ghost" size="icon" className="dash-more" aria-label={`Remove @${account.username} from ${group.name}`} onClick={() => void act(() => setMember({ groupId: group.id, accountId: account.id, member: false }), 'Could not remove this account.')}><X /></Button>
    </div>)}
    {!members.length && <div className="dash-list-row dash-list-note">No accounts yet. Add the accounts you post to together.</div>}
  </Card>;
}

/** The Groups section: a card per group, New group, and a note on how groups work. */
export function AccountGroups({ accounts }: { accounts: PickerAccount[] }) {
  const groups = useAccountGroups(), create = useMutation(api.postingGroups.create);
  const [error, setError] = useState('');
  async function add() {
    setError('');
    try { await create({}); } catch (reason) { setError(userError(reason, 'Could not create a group.')); }
  }
  return <section className="account-groups" aria-labelledby="account-groups-title">
    <div className="account-groups-head">
      <div><h2 id="account-groups-title">Groups</h2><p>Group accounts so one click picks them all when you post. Star one as your default.</p></div>
      <Button variant="primary" size="sm" disabled={!groups} onClick={() => void add()}><Plus />New group</Button>
    </div>
    {error && <p className="dash-error" role="alert">{error}</p>}
    {groups && (groups.length ? <div className="account-groups-grid">
      {groups.map(group => <GroupCard key={group.id} group={group} accounts={accounts} onError={setError} />)}
      <Card variant="dash" className="dash-list account-group">
        <div className="dash-list-head"><h2>All accounts</h2><span className="dash-list-meta">{accounts.length} connected</span></div>
        <div className="dash-list-row dash-list-note">An account can sit in several groups. Removing it from a group does not disconnect it.</div>
      </Card>
    </div> : <Card variant="dash" className="dash-list"><div className="dash-list-row dash-list-note">No groups yet. Make one, like “Main” with your TikTok and Instagram, to pick them together when you post.</div></Card>)}
  </section>;
}
