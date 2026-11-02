'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation } from 'convex/react';
import { Film, LoaderCircle, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PrimaryButton } from './primary-button';
import { WorkspaceNav, chatRecency, useWorkspaceChats, type WorkspaceChat } from './workspace-nav';
import './workspace-pages.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ChatHistory() {
  const { chats, loading, connected } = useWorkspaceChats();
  const update = useMutation(api.projects.update);
  const remove = useMutation(api.projects.remove);
  const [search, setSearch] = useState('');
  const [renaming, setRenaming] = useState<WorkspaceChat | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceChat | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actionTrigger = useRef<HTMLButtonElement | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  function clearSearch() { setSearch(''); searchInput.current?.focus(); }
  function returnFocus(event: Event) { dialogRequested.current = false; event.preventDefault(); if (actionTrigger.current?.isConnected) actionTrigger.current.focus(); else searchInput.current?.focus(); }
  const dialogRequested = useRef(false);
  const rememberTrigger = useCallback((trigger: HTMLButtonElement) => { actionTrigger.current = trigger; }, []);
  const onMenuClose = useCallback((event: Event) => { if (dialogRequested.current) event.preventDefault(); }, []);
  const openRename = useCallback((chat: WorkspaceChat) => { dialogRequested.current = true; setRenaming(chat); setName(chat.title); setError(''); }, []);
  const openDelete = useCallback((chat: WorkspaceChat) => { dialogRequested.current = true; setDeleting(chat); setError(''); }, []);
  const filtered = useMemo(() => { const query = search.trim().toLocaleLowerCase(); return chats.filter(chat => chat.title.toLocaleLowerCase().includes(query)); }, [chats, search]);
  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    const groups: { label: string; chats: WorkspaceChat[] }[] = ['Today', 'Yesterday', 'Earlier'].map(label => ({ label, chats: [] }));
    for (const chat of filtered) groups[chat.updatedAt >= today.getTime() ? 0 : chat.updatedAt >= yesterday.getTime() ? 1 : 2].chats.push(chat);
    return groups;
  }, [filtered]);
  function closeDialogs() { if (busy) return; setRenaming(null); setDeleting(null); setError(''); }
  async function rename() {
    if (!renaming || renaming.id === 'demo' || !name.trim() || busy) return;
    setBusy(true); setError('');
    try { await update({ projectId: renaming.id, title: name.trim() }); setRenaming(null); }
    catch (reason) { setError(userError(reason, 'Could not rename this chat.')); }
    finally { setBusy(false); }
  }
  async function deleteChat() {
    if (!deleting || deleting.id === 'demo' || busy) return;
    setBusy(true); setError('');
    try { await remove({ projectId: deleting.id }); setDeleting(null); }
    catch (reason) { setError(userError(reason, 'Could not delete this chat.')); }
    finally { setBusy(false); }
  }
  return <div className="workspace-page workspace-history-page">
    <WorkspaceNav title="Your chats" active="chats" />
    <main className="workspace-history-content">
      <div className="workspace-page-heading"><h1>Your chats</h1><p>Continue where you left off, or start something new.</p></div>
      <div className="workspace-history-tools"><div className="workspace-search relative"><Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input ref={searchInput} className="pl-8 pr-8" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search your chats" aria-label="Search your chats" />{search && <Button type="button" variant="ghost" size="icon-xs" className="absolute right-1.5 top-1/2 -translate-y-1/2" onClick={clearSearch} aria-label="Clear search"><X size={14} /></Button>}</div><PrimaryButton asChild className="workspace-new-chat-button"><Link href={NEW_PROJECT_PATH}>{NEW_WORKSPACE_LABEL}<Plus size={15} /></Link></PrimaryButton></div>
      {loading ? <div className="workspace-empty-state" role="status"><LoaderCircle size={20} className="animate-spin" /><p>Loading your chats…</p></div> : filtered.length ? <div className="workspace-chat-groups">{groups.filter(group => group.chats.length).map(group => <section key={group.label} className="workspace-chat-group"><h2>{group.label}</h2>{group.chats.map(chat => <ChatHistoryRow key={chat.id} chat={chat} onRename={openRename} onDelete={openDelete} onActionTrigger={rememberTrigger} onMenuClose={onMenuClose}/>)}</section>)}</div> : <div className="workspace-empty-state"><span className="workspace-empty-icon">{search ? <Search size={20} /> : <MessageSquare size={20} />}</span><h2>{search ? 'Nothing matches that search.' : 'Your first edit starts here.'}</h2><p>{search ? 'Try another name from a previous conversation.' : 'Add your footage and start a conversation. Your chats will be waiting here.'}</p>{search ? <Button variant="outline" size="md" onClick={clearSearch}>Clear search</Button> : <PrimaryButton asChild size="compact"><Link href={connected ? NEW_PROJECT_PATH : '/sign-in'}>{connected ? NEW_WORKSPACE_LABEL : 'Sign in'}{connected && <Plus size={15} />}</Link></PrimaryButton>}</div>}
    </main>
    <Dialog open={!!renaming} onOpenChange={open => { if (!open) closeDialogs(); }}><DialogContent className="workspace-dialog" onCloseAutoFocus={returnFocus}><DialogTitle>Rename chat</DialogTitle><DialogDescription>Give this conversation a name you can find later.</DialogDescription><form onSubmit={event => { event.preventDefault(); void rename(); }}><label className="workspace-form-field">Chat name<Input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>{error && <p className="workspace-inline-error" role="alert">{error}</p>}<div className="workspace-dialog-actions"><Button variant="outline" size="md" type="button" onClick={closeDialogs} disabled={busy}>Cancel</Button><PrimaryButton type="submit" disabled={busy || !name.trim()}>{busy && <LoaderCircle size={14} className="animate-spin" />}Save name</PrimaryButton></div></form></DialogContent></Dialog>
    <Dialog open={!!deleting} onOpenChange={open => { if (!open) closeDialogs(); }}><DialogContent className="workspace-dialog" onCloseAutoFocus={returnFocus}><DialogTitle>Delete this chat?</DialogTitle><DialogDescription>“{deleting?.title}” and its footage will be permanently removed.</DialogDescription>{error && <p className="workspace-inline-error" role="alert">{error}</p>}<div className="workspace-dialog-actions"><Button variant="outline" size="md" onClick={closeDialogs} disabled={busy}>Cancel</Button><Button variant="destructive" size="md" onClick={() => void deleteChat()} disabled={busy}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}Delete chat</Button></div></DialogContent></Dialog>
  </div>;
}

const ChatHistoryRow = memo(function ChatHistoryRow({ chat, onRename, onDelete, onActionTrigger, onMenuClose }: {
  chat: WorkspaceChat; onRename: (chat: WorkspaceChat) => void; onDelete: (chat: WorkspaceChat) => void;
  onActionTrigger: (trigger: HTMLButtonElement) => void; onMenuClose: (event: Event) => void;
}) {
  return <article className="workspace-chat-row">
        <Link className="workspace-chat-row-link" href={`/editor/${chat.id}`}><span className="workspace-chat-cover">{chat.coverUrl ? chat.coverKind === 'video' ? <video src={`${chat.coverUrl}#t=.1`} muted preload="metadata" /> : <img src={chat.coverUrl} alt="" loading="lazy" /> : <Film size={18} />}</span><span className="workspace-chat-description"><strong>{chat.title}</strong><span>{chat.clipCount ? `${chat.clipCount} ${chat.clipCount === 1 ? 'clip' : 'clips'} in your edit` : 'Ready for your footage'}</span></span><span className={`workspace-chat-activity${chat.running ? ' is-editing' : ''}`}>{chat.running ? 'Editing…' : chatRecency(chat.updatedAt)}</span></Link>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${chat.title}`} onFocus={event => { onActionTrigger(event.currentTarget); }} onPointerDown={event => { onActionTrigger(event.currentTarget); }}><MoreHorizontal size={16} /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="workspace-menu workspace-row-menu" onCloseAutoFocus={onMenuClose}><DropdownMenuItem className="workspace-menu-item" onSelect={() => onRename(chat)}><Pencil size={14} />Rename</DropdownMenuItem><DropdownMenuItem className="workspace-menu-item" onSelect={() => onDelete(chat)}><Trash2 size={14} />Delete chat</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </article>;
});
