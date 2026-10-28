'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Copy, Download, Pencil, Plus, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AspectRatio } from '@/lib/editor/types';
import { AgentLogo } from '@/components/workspace/agent-logo';
import { ClaudeLogo, CursorLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import './timeline-tabs.css';

export type TimelineTab = { id: string; name: string; aspectRatio: AspectRatio; duration: number; active: boolean };
export type TimelineTabActions = {
  onOpen: (id: string) => Promise<void>;
  onCreate: (from: 'blank' | 'duplicate') => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onExport?: (id: string) => void;
};

const length = (seconds: number) => { const total = Math.round(seconds); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

/** Spreadsheet-style tabs on top of the timeline: each is its own video in this project. */
export function TimelineTabs({ tabs, working, agentName, mcpConnection, locked, onError, ...actions }: { tabs: TimelineTab[]; working: boolean; /** The MCP app editing, or null for Revline's own AI. */ agentName?: string | null; /** The app connected over MCP, null when none is, undefined while loading. */ mcpConnection?: string | null; locked: boolean; onError: (error: unknown) => void } & TimelineTabActions) {
  const [busy, setBusy] = useState(false);
  // The clicked tab highlights on the next frame; the timeline it opens follows.
  const [opening, setOpening] = useState<string | null>(null);
  const shown = opening ?? tabs.find(tab => tab.active)?.id;
  useEffect(() => { if (opening && tabs.find(tab => tab.active)?.id === opening) setOpening(null); }, [tabs, opening]);
  const [dialog, setDialog] = useState<{ mode: 'rename' | 'remove'; id: string; name: string } | null>(null);
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const blocked = locked || busy;
  // The tab an agent was editing glows green for two seconds once it stops (or moves to another tab).
  const workingId = working ? tabs.find(tab => tab.active)?.id ?? null : null;
  const [doneId, setDoneId] = useState<string | null>(null);
  const lastWorking = useRef<string | null>(null), doneTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const finished = lastWorking.current;
    lastWorking.current = workingId;
    if (!finished || finished === workingId) return;
    setDoneId(finished); clearTimeout(doneTimer.current);
    doneTimer.current = setTimeout(() => setDoneId(current => current === finished ? null : current), 2000);
  }, [workingId]);
  useEffect(() => () => clearTimeout(doneTimer.current), []);
  return <div className="timeline-tabs" role="tablist" aria-label="Timelines">
    {tabs.map(tab => { const isShown = tab.id === shown; return <div key={tab.id} className="timeline-tab" role="tab" aria-selected={isShown} data-active={isShown || undefined} data-working={tab.id === workingId || undefined} data-done={tab.id === doneId && tab.id !== workingId || undefined}>
      <button type="button" className="timeline-tab-main" disabled={!tab.active && blocked} title={!tab.active && locked ? 'Wait for the AI edit to finish before switching' : tab.name} onClick={() => { if (!tab.active && !busy) { setOpening(tab.id); void run(() => actions.onOpen(tab.id)).finally(() => setOpening(null)); } }} onDoubleClick={() => { if (tab.active && !locked) setDialog({ mode: 'rename', id: tab.id, name: tab.name }); }}>
        {tab.id === workingId && <span className="timeline-tab-agent" aria-hidden="true"><AgentLogo name={agentName} /></span>}
        <span className="timeline-tab-name">{tab.name}</span>
        <span className="timeline-tab-length">{length(tab.duration)}</span>
      </button>
      {<DropdownMenu><DropdownMenuTrigger className="timeline-tab-menu" aria-label={`Options for ${tab.name}`} tabIndex={isShown ? 0 : -1} aria-hidden={!isShown || undefined} disabled={!isShown}><ChevronDown size={12}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="timeline-tab-options">
        <DropdownMenuItem disabled={locked} onSelect={() => setDialog({ mode: 'rename', id: tab.id, name: tab.name })}><Pencil/>Rename</DropdownMenuItem>
        <DropdownMenuItem disabled={blocked} onSelect={() => void run(() => actions.onCreate('duplicate'))}><Copy/>Duplicate</DropdownMenuItem>
        {actions.onExport && <DropdownMenuItem onSelect={() => actions.onExport?.(tab.id)}><Download/>Export this video</DropdownMenuItem>}
        <DropdownMenuSeparator/>
        <DropdownMenuItem variant="destructive" disabled={blocked || tabs.length <= 1} onSelect={() => setDialog({ mode: 'remove', id: tab.id, name: tab.name })}><Trash2/>Delete timeline</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>}
    </div>; })}
    <button type="button" className="timeline-tab-add" aria-label="New blank timeline" title="New blank timeline" disabled={blocked} onClick={() => void run(() => actions.onCreate('blank'))}><Plus size={14}/></button>
    {mcpConnection ? <Link href="/profile#mcp" className="timeline-mcp"><AgentLogo name={mcpConnection} className="timeline-mcp-logo"/>MCP connected</Link>
      : mcpConnection === null && <Link href="/profile#mcp" className="timeline-mcp" data-connect><span className="timeline-mcp-apps" aria-hidden="true"><ClaudeLogo/><OpenAILogo/><CursorLogo/></span>Connect MCP</Link>}
    <Dialog open={!!dialog} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent>
      {dialog?.mode === 'remove' ? <>
        <DialogTitle>Delete {dialog.name}?</DialogTitle><DialogDescription>This timeline and its undo history go away. Media stays in the project and other timelines are unchanged.</DialogDescription>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => { const id = dialog.id; setDialog(null); void run(() => actions.onRemove(id)); }}>Delete timeline</Button></div>
      </> : <>
        <DialogTitle>Rename timeline</DialogTitle><DialogDescription>The name labels this video and its exported file.</DialogDescription>
        <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); if (!dialog?.name.trim()) return; const { id, name } = dialog; setDialog(null); void run(() => actions.onRename(id, name)); }}><Input aria-label="Timeline name" autoFocus maxLength={60} value={dialog?.name ?? ''} onChange={event => setDialog(current => current ? { ...current, name: event.target.value } : null)}/><Button type="submit" disabled={!dialog?.name.trim()}>Save name</Button></form>
      </>}
    </DialogContent></Dialog>
  </div>;
}
