'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { memo, useEffect, useMemo, useRef, useState, type ReactNode, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useConvexAuth, usePaginatedQuery, useQuery } from 'convex/react';
import { Check, ChevronDown, CircleAlert, Copy, Download, Film, History, LoaderCircle, PanelsTopLeft, Pencil, Plus, Redo2, Undo2 } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Brand } from './brand';
import { ProjectCover } from './project-cover';
import { startNewWorkspace } from './start-new-workspace';
import { PrimaryButton } from './primary-button';
import { Button } from '@/components/ui/button';
import { WorkspaceAccountLink } from './account-link';
import { DiscordLink } from './discord-link';
import { Input } from '@/components/ui/input';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './workspace-pages.css';
import type { WorkingAgent } from '@/lib/mcp/agent-identity';
import { useInDashboardShell } from '@/components/dashboard/shell-context';

export type WorkspaceChat = {
  id: Id<'projects'> | 'demo'; title: string; updatedAt: number; clipCount: number;
  coverUrl: string | null; coverKind: 'video' | 'image' | null; running: boolean;
  /** The MCP app editing this chat; it counts as working while `running` or until `until`. */
  agent: { name: string; until: number; running: boolean } | null;
  agents: WorkingAgent[];
};

/** Recent chats in the title menu, in one page; the list scrolls inside the menu. */
const RECENT_CHATS = 20;
/** Projects per page on the chats list; older ones load on request. */
export const CHAT_PAGE_SIZE = 24;

/** The owner's projects, newest first, in pages: each page is its own subscription, so an edit to one project
 * re-runs only its page. Working MCP agents arrive from a separate small query and are joined here. */
export function useWorkspaceChats(demo = false, enabled = true, limit = CHAT_PAGE_SIZE) {
  const { isLoaded, isSignedIn } = useUser();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const connected = !!isSignedIn && isAuthenticated && !demo;
  const active = connected && enabled;
  const { results: projects, status, loadMore } = usePaginatedQuery(api.projects.listPage, active ? {} : 'skip', { initialNumItems: limit });
  const working = useQuery(api.projects.workingAgents, active ? {} : 'skip');
  const chats = useMemo<WorkspaceChat[]>(() => {
    if (!connected) return [];
    const agentsByProject = new Map((working ?? []).map(row => [row.projectId, row.agents]));
    return projects.map(project => {
      const agents = agentsByProject.get(project._id) ?? [], agent = agents[0];
      return {
        id: project._id, title: project.title, updatedAt: project.updatedAt,
        clipCount: project.clipCount, coverUrl: project.coverUrl,
        coverKind: project.coverKind, running: !!project.aiRunning, agent: agent ? { name: agent.name, until: agent.until, running: false } : null, agents,
      };
    });
  }, [connected, projects, working]);
  const loading = enabled && (!isLoaded || (!demo && !!isSignedIn && (isLoading || (isAuthenticated && status === 'LoadingFirstPage'))));
  return { chats, loading, connected, loadMore, canLoadMore: status === 'CanLoadMore', loadingMore: status === 'LoadingMore' };
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
  active?: 'chat' | 'chats' | 'profile' | 'storage' | 'accounts' | 'posts';
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
  /** The editor's bar: the logo links back to this page, and a "Saved" mark shows once changes are stored. */
  backHref?: string;
  /** Extra actions at the right of the bar, after Export. */
  actions?: ReactNode;
  exportDisabled?: boolean;
  /** Explains a disabled export or its limit before the dialog opens. */
  exportHint?: string;
  onRename?: (title: string) => void | Promise<void>;
  chatId?: string;
  editorControls?: ReactNode;
}

/** Pages inside the signed-in shell have its navbar, which names them from the address; the editor keeps this bar. */
export const WorkspaceNav = memo(function WorkspaceNav(props: WorkspaceNavProps) {
  const inShell = useInDashboardShell();
  if (inShell) return null;
  return <WorkspaceTopBar {...props} />;
});

const WorkspaceTopBar = memo(function WorkspaceTopBar({ title = NEW_WORKSPACE_LABEL, editorHref, active = 'chat', demo = false, saving, saveFailed, onRetrySave, canUndo, canRedo, onUndo, onRedo, onFootage, onExport, backHref, actions, exportDisabled, exportHint, onRename, chatId, editorControls }: WorkspaceNavProps) {
  const pathname = usePathname();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { chats, loading } = useWorkspaceChats(demo, historyOpen, RECENT_CHATS);
  // Ticks while the menu is open so an agent's working state ends on time.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { if (!historyOpen) return; setClock(Date.now()); const timer = setInterval(() => setClock(Date.now()), 5000); return () => clearInterval(timer); }, [historyOpen]);
  const { user } = useUser();
  const [accountError, setAccountError] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  // Account pages sit under the workspace; they show where you are, not the chat menu.
  const settingsPage = active === 'profile' || active === 'storage' || active === 'accounts' || active === 'posts';
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [copyError, setCopyError] = useState('');
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const homeHref = backHref ?? NEW_PROJECT_PATH;
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
  // The link opens the start page at once. The previous import is dropped in memory first; its stored copy is cleared behind the navigation.
  function newWorkspace(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    void startNewWorkspace(user?.id).catch(reason => setAccountError(userError(reason, 'Could not open a new workspace.')));
  }
  return <><header className="workspace-nav">
    <Link href={homeHref} onClick={homeHref === NEW_PROJECT_PATH ? newWorkspace : undefined} className="workspace-nav-brand" aria-label="Revline home"><Brand /></Link>
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
        {loading ? <div className="workspace-menu-empty"><LoaderCircle size={14} className="animate-spin" />Loading chats…</div> : chats.length ? <div className="workspace-menu-chats">{chats.map(chat => { const agent = chat.agent && (chat.agent.running || chat.agent.until > clock) ? chat.agent : null; return <DropdownMenuItem key={chat.id} asChild className="workspace-menu-chat"><Link href={`/editor/${chat.id}`}><ProjectCover url={chat.coverUrl} kind={chat.coverKind}/><span className="workspace-menu-chat-details"><strong className={chat.running || agent ? 'shimmer' : undefined}>{chat.title}</strong><small>{chatRecency(chat.updatedAt)}</small></span>{pathname === `/editor/${chat.id}` && <Check size={14} />}</Link></DropdownMenuItem>; })}</div> : <div className="workspace-menu-empty">Your chats will appear here.</div>}
        <DropdownMenuSeparator className="workspace-menu-divider" />
        <DropdownMenuItem asChild className="workspace-menu-item"><Link href="/chats" aria-current={active === 'chats' ? 'page' : undefined}><History size={15} />See all chats</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu></>}
    {editorControls}
    <div className="workspace-nav-actions">
      {saving && <span className="workspace-nav-save" data-editor={backHref ? '' : undefined} role="status"><LoaderCircle size={13} className="animate-spin" />Saving…</span>}
      {backHref && !demo && saving === false && !saveFailed && <span className="workspace-nav-save" data-editor="" role="status"><Check size={13} />Saved</span>}
      {saveFailed && onRetrySave && <Button variant="outline" size="md" type="button" className="workspace-nav-unsaved" aria-label="Unsaved changes. Retry saving" onClick={onRetrySave}><CircleAlert size={14} aria-hidden="true" /><span>Unsaved changes — Retry</span></Button>}
      {(onUndo || onRedo) && <div className="workspace-nav-history"><Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!canUndo} onClick={onUndo}><Undo2 size={15} /></Button><Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!canRedo} onClick={onRedo}><Redo2 size={15} /></Button></div>}
      {onFootage && <Button variant="outline" size="md" aria-label="Footage" onClick={onFootage}><Film size={14} /><span>Footage</span></Button>}
      {onExport && !demo && <span className="workspace-nav-action-hint"><Button size={backHref ? 'sm' : 'md'} variant={backHref ? 'soft' : 'default'} className="workspace-nav-export" onClick={onExport} disabled={exportDisabled} aria-description={exportHint}>{backHref && <Download size={14} />}Export{!backHref && <Download size={13} />}</Button></span>}
      {actions}
      {editorHref && <Button asChild variant="outline" size="md"><Link href={editorHref} className="workspace-editor-link" aria-label="Editor"><PanelsTopLeft size={14} /><span>Editor</span></Link></Button>}
      {!demo && !pathname?.startsWith('/editor') && <DiscordLink />}
      {accountError && <p className="workspace-inline-error" role="alert">{accountError}</p>}
      <WorkspaceAccountLink />
    </div>
  </header><Dialog open={renameOpen} onOpenChange={open => { if (!renameBusy) setRenameOpen(open); }}><DialogContent className="workspace-dialog" onCloseAutoFocus={event => { event.preventDefault(); historyTrigger.current?.focus(); }}><DialogTitle>Rename chat</DialogTitle><DialogDescription>Give this conversation a name you can find later.</DialogDescription><form onSubmit={event => { event.preventDefault(); void rename(); }}><label className="workspace-form-field">Chat name<Input autoFocus value={newTitle} maxLength={120} onChange={event => setNewTitle(event.target.value)} /></label>{renameError && <p className="workspace-inline-error" role="alert">{renameError}</p>}<div className="workspace-dialog-actions"><Button variant="outline" size="md" type="button" onClick={() => setRenameOpen(false)} disabled={renameBusy}>Cancel</Button><PrimaryButton type="submit" disabled={renameBusy || !newTitle.trim()}>{renameBusy && <LoaderCircle size={14} className="animate-spin" />}Save name</PrimaryButton></div></form></DialogContent></Dialog></>;
});
