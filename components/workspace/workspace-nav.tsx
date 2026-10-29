'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { useRef, useState, type ReactNode, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useClerk, useUser } from '@clerk/nextjs';
import { signOutToSignIn } from '@/lib/auth/sign-out';
import { useConvexAuth, useQuery } from 'convex/react';
import { Check, ChevronDown, CircleAlert, Cloud, Copy, CreditCard, Database, Download, Film, History, LoaderCircle, LogOut, Palette, PanelsTopLeft, Pencil, Plus, Redo2, UserRound, Undo2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Brand } from './brand';
import { ClaudeLogo, CursorLogo, OpenAILogo } from './ai-app-logos';
import { ProjectCover } from './project-cover';
import { startNewWorkspace } from './start-new-workspace';
import { PrimaryButton } from './primary-button';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './workspace-pages.css';

export type WorkspaceChat = {
  id: Id<'projects'> | 'demo'; title: string; updatedAt: number; clipCount: number;
  coverUrl: string | null; coverKind: 'video' | 'image' | null; running: boolean;
};

export function useWorkspaceChats(demo = false, enabled = true, limit = 100) {
  const { isLoaded, isSignedIn } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const connected = !!isSignedIn && isAuthenticated && !demo;
  const projects = useQuery(api.projects.list, connected && enabled ? { limit } : 'skip');
  const chats: WorkspaceChat[] = connected ? (projects ?? []).map(project => ({
    id: project._id, title: project.title, updatedAt: project.updatedAt,
    clipCount: project.clipCount, coverUrl: project.coverUrl,
    coverKind: project.coverKind, running: !!project.aiRunning,
  })) : [];
  return { chats, loading: enabled && (!isLoaded || (!demo && !!isSignedIn && (isLoading || (isAuthenticated && projects === undefined)))), connected };
}

export function chatRecency(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  return timestamp >= today.getTime() ? 'Today' : timestamp >= yesterday.getTime() ? 'Yesterday' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export interface WorkspaceNavProps {
  title?: string;
  editorHref?: string;
  active?: 'chat' | 'chats' | 'profile' | 'storage' | 'brand-kits';
  demo?: boolean;
  saving?: boolean;
  saveFailed?: boolean;
  onRetrySave?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onFootage?: () => void;
  onExport?: () => void;
  exportDisabled?: boolean;
  /** Explains a disabled export or its limit before the dialog opens. */
  exportHint?: string;
  onRename?: (title: string) => void | Promise<void>;
  chatId?: string;
  editorControls?: ReactNode;
}

export function WorkspaceNav({ title = NEW_WORKSPACE_LABEL, editorHref, active = 'chat', demo = false, saving, saveFailed, onRetrySave, canUndo, canRedo, onUndo, onRedo, onFootage, onExport, exportDisabled, exportHint, onRename, chatId, editorControls }: WorkspaceNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const startingWorkspace = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { chats, loading } = useWorkspaceChats(demo, historyOpen, 4);
  const { user, isSignedIn, isLoaded } = useUser();
  const clerk = useClerk();
  const [accountError, setAccountError] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  // Account pages sit under the workspace; they show where you are, not the chat menu.
  const settingsPage = active === 'profile' || active === 'storage' || active === 'brand-kits';
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [copyError, setCopyError] = useState('');
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const initial = (user?.firstName ?? user?.primaryEmailAddress?.emailAddress ?? 'D').slice(0, 1).toUpperCase();
  async function signOut() {
    setSigningOut(true); setAccountError('');
    try { await signOutToSignIn(clerk); }
    catch { setAccountError('Could not sign out. Please try again.'); setSigningOut(false); }
  }
  async function rename() {
    if (!onRename || !newTitle.trim() || newTitle.trim().length > 120 || renameBusy) return;
    setRenameBusy(true); setRenameError('');
    try { await onRename(newTitle.trim()); setRenameOpen(false); }
    catch (reason) { setRenameError(userError(reason, 'Could not rename this chat.')); }
    finally { setRenameBusy(false); }
  }
  async function copyChatId() {
    if (!chatId) return;
    try { await navigator.clipboard.writeText(chatId); setCopiedId(true); setCopyError(''); }
    catch { setCopyError('Could not copy the chat ID.'); }
  }
  async function newWorkspace(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (startingWorkspace.current) return;
    startingWorkspace.current = true;
    try { await startNewWorkspace(user?.id); router.push(NEW_PROJECT_PATH); }
    catch (reason) { setAccountError(userError(reason, 'Could not open a new workspace.')); }
    finally { startingWorkspace.current = false; }
  }
  return <><header className="workspace-nav">
    <Link href={NEW_PROJECT_PATH} onClick={newWorkspace} className="workspace-nav-brand" aria-label="Revline home"><Brand /></Link>
    <span className="workspace-nav-divider" aria-hidden="true" />
    {settingsPage ? <Breadcrumb className="workspace-breadcrumb"><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><Link href="/chats">Workspace</Link></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{title}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb> : <>
    <DropdownMenu onOpenChange={open => { setHistoryOpen(open); if (open) { setCopiedId(false); setCopyError(''); } }}><DropdownMenuTrigger asChild><Button ref={historyTrigger} variant="ghost" size="md" className="workspace-chat-trigger" aria-label="Open chat menu"><span>{title}</span><ChevronDown size={13} /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={10} className="workspace-menu workspace-history-menu" onCloseAutoFocus={event => { if (renameOpen) event.preventDefault(); }}>
        <DropdownMenuItem asChild className="workspace-menu-item"><Link href={NEW_PROJECT_PATH} onClick={newWorkspace}><Plus size={16} />{NEW_WORKSPACE_LABEL}</Link></DropdownMenuItem>
        {onRename && <DropdownMenuItem className="workspace-menu-item" onSelect={() => { setNewTitle(title); setRenameError(''); setRenameOpen(true); }}><Pencil size={15} />Rename chat</DropdownMenuItem>}
        {chatId && <DropdownMenuItem className="workspace-menu-item" onSelect={event => { event.preventDefault(); void copyChatId(); }}>{copiedId ? <Check size={15} /> : <Copy size={15} />}{copiedId ? 'Chat ID copied' : 'Copy chat ID'}</DropdownMenuItem>}
        {copyError && <p className="workspace-inline-error" role="alert">{copyError}</p>}
        <DropdownMenuSeparator className="workspace-menu-divider" />
        <DropdownMenuLabel className="workspace-menu-label">Recent chats</DropdownMenuLabel>
        {loading ? <div className="workspace-menu-empty"><LoaderCircle size={14} className="animate-spin" />Loading chats…</div> : chats.length ? chats.slice(0, 4).map(chat => <DropdownMenuItem key={chat.id} asChild className="workspace-menu-chat"><Link href={`/editor/${chat.id}`}><ProjectCover url={chat.coverUrl} kind={chat.coverKind}/><span className="workspace-menu-chat-details"><strong>{chat.title}</strong><small>{chatRecency(chat.updatedAt)}</small></span>{pathname === `/editor/${chat.id}` && <Check size={14} />}</Link></DropdownMenuItem>) : <div className="workspace-menu-empty">Your chats will appear here.</div>}
        <DropdownMenuSeparator className="workspace-menu-divider" />
        <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/chats" aria-current={active === 'chats' ? 'page' : undefined}><History size={15} />See all chats</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu></>}
    {editorControls}
    <div className="workspace-nav-actions">
      {!demo && !onExport && !editorControls && <Button asChild variant="outline" size="md"><Link href="/storage" aria-label="Cloud storage" aria-current={active==='storage'?'page':undefined}><Cloud size={15}/><span>Cloud storage</span></Link></Button>}
      {saving && <span className="workspace-nav-save" role="status"><LoaderCircle size={13} className="animate-spin" />Saving…</span>}
      {saveFailed && onRetrySave && <Button variant="outline" size="md" type="button" className="workspace-nav-unsaved" aria-label="Unsaved changes. Retry saving" onClick={onRetrySave}><CircleAlert size={14} aria-hidden="true" /><span>Unsaved changes — Retry</span></Button>}
      {(onUndo || onRedo) && <div className="workspace-nav-history"><Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></Button><Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></Button></div>}
      {onFootage && <Button variant="outline" size="md" aria-label="Footage" onClick={onFootage}><Film size={14} /><span>Footage</span></Button>}
      {onExport && !demo && <span className="workspace-nav-action-hint"><Button size="md" className="workspace-nav-export" onClick={onExport} disabled={exportDisabled} aria-description={exportHint}>Export<Download size={13} /></Button></span>}
      {editorHref && <Button asChild variant="outline" size="md"><Link href={editorHref} className="workspace-editor-link" aria-label="Editor"><PanelsTopLeft size={14} /><span>Editor</span></Link></Button>}
      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="workspace-account-trigger rounded-full p-0" aria-label="Open account menu" disabled={!isLoaded}><Avatar>{user?.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}<AvatarFallback>{initial}</AvatarFallback></Avatar></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={12} className="workspace-menu workspace-account-menu">
          <div className="workspace-account-identity"><Avatar size="lg">{user?.imageUrl && <AvatarImage src={user.imageUrl} alt="" />}<AvatarFallback>{initial}</AvatarFallback></Avatar><div><strong>{user?.fullName ?? (isSignedIn ? 'Your account' : 'Demo workspace')}</strong><span>{user?.primaryEmailAddress?.emailAddress ?? 'Sign in to save your work'}</span></div></div>
          <DropdownMenuSeparator className="workspace-menu-divider" />
          <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/profile" aria-current={active === 'profile' ? 'page' : undefined}><UserRound size={16} />Profile</Link></DropdownMenuItem>
          <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/storage" aria-current={active === 'storage' ? 'page' : undefined}><Database size={16} />Cloud storage</Link></DropdownMenuItem>
          <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/brand-kits" aria-current={active === 'brand-kits' ? 'page' : undefined}><Palette size={16} />Brand kits</Link></DropdownMenuItem>
          <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/profile#billing"><CreditCard size={16} />Membership & billing</Link></DropdownMenuItem>
          <DropdownMenuSeparator className="workspace-menu-divider" />
          {isSignedIn ? <DropdownMenuItem className="workspace-menu-item" disabled={signingOut} onSelect={event => { event.preventDefault(); void signOut(); }}>{signingOut ? <LoaderCircle size={16} className="animate-spin" /> : <LogOut size={16} />}Sign out</DropdownMenuItem> : <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/sign-in"><LogOut size={16} />Sign in</Link></DropdownMenuItem>}
          {accountError && <p className="workspace-inline-error" role="alert">{accountError}</p>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </header><Dialog open={renameOpen} onOpenChange={open => { if (!renameBusy) setRenameOpen(open); }}><DialogContent className="workspace-dialog" onCloseAutoFocus={event => { event.preventDefault(); historyTrigger.current?.focus(); }}><DialogTitle>Rename chat</DialogTitle><DialogDescription>Give this conversation a name you can find later.</DialogDescription><form onSubmit={event => { event.preventDefault(); void rename(); }}><label className="workspace-form-field">Chat name<Input autoFocus value={newTitle} maxLength={120} onChange={event => setNewTitle(event.target.value)} /></label>{renameError && <p className="workspace-inline-error" role="alert">{renameError}</p>}<div className="workspace-dialog-actions"><Button variant="outline" size="md" type="button" onClick={() => setRenameOpen(false)} disabled={renameBusy}>Cancel</Button><PrimaryButton type="submit" disabled={renameBusy || !newTitle.trim()}>{renameBusy && <LoaderCircle size={14} className="animate-spin" />}Save name</PrimaryButton></div></form></DialogContent></Dialog></>;
}
