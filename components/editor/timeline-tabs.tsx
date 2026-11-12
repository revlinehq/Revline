'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Copy, Download, List, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AspectRatio } from '@/lib/editor/types';
import { AgentLogo } from '@/components/workspace/agent-logo';
import { WorkingAgents } from '@/components/workspace/working-agents';
import type { WorkingAgent } from '@/lib/mcp/agent-identity';
import './timeline-tabs.css';
import { minutesSeconds } from './minutes-seconds';

export type TimelineTab = { id: string; name: string; aspectRatio: AspectRatio; duration: number; active: boolean; agents?: WorkingAgent[]; /** The tab the AI is editing while another one is only viewed. */ editing?: boolean; /** Its first shot, for the export picker. */ cover?: string | null };
export type TimelineTabActions = {
  onOpen: (id: string) => Promise<void>;
  onCreate: (from: 'blank' | 'duplicate') => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onExport?: (id: string) => void;
  /** Opens the post dialog for this timeline. */
  onPost?: (id: string) => void;
};

/** Above this many timelines the list menu gets a search field. */
const SEARCH_FROM = 10;
const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** Ctrl/Cmd+Alt+[ and ] switch timelines; no editor shortcut uses Alt with brackets. */
const shortcut = (key: '[' | ']') => isMac() ? `⌘⌥${key}` : `Ctrl+Alt+${key}`;

/** Spreadsheet-style tabs in the bar above the preview: each is its own video in this project. */
export function TimelineTabs({ tabs, working, agentName, locked, postLocked, onError, ...actions }: { tabs: TimelineTab[]; working: boolean; /** The MCP app editing, or null for Revline's own AI. */ agentName?: string | null; locked: boolean; /** An AI run is active: posts wait for it. */ postLocked?: boolean; onError: (error: unknown) => void } & TimelineTabActions) {
  const [busy, setBusy] = useState(false);
  // The clicked tab highlights on the next frame; the timeline it opens follows.
  const [opening, setOpening] = useState<string | null>(null);
  const shown = opening ?? tabs.find(tab => tab.active)?.id;
  useEffect(() => { if (opening && tabs.find(tab => tab.active)?.id === opening) setOpening(null); }, [tabs, opening]);
  const [dialog, setDialog] = useState<{ mode: 'rename' | 'remove'; id: string; name: string } | null>(null);
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); try { await action(); } catch (error) { onError(error); } finally { setBusy(false); } };
  const blocked = locked || busy;
  // The tab an agent was editing glows green for two seconds once it stops (or moves to another tab).
  const workingId = tabs.find(tab=>tab.agents?.length)?.id ?? (working ? (tabs.find(tab => tab.editing) ?? tabs.find(tab => tab.active))?.id ?? null : null);
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
  // A mouse wheel scrolls the tab row sideways once there are more tabs than fit.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = strip.current; if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) >= Math.abs(event.deltaY) || element.scrollWidth <= element.clientWidth) return;
      event.preventDefault(); element.scrollLeft += event.deltaY;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);
  // ‹ and › show only while the row overflows, each disabled at its end.
  const [edges, setEdges] = useState({ overflow: false, start: true, end: true });
  const measure = useCallback(() => {
    const element = strip.current; if (!element) return;
    const overflow = element.scrollWidth > element.clientWidth + 1;
    const next = { overflow, start: element.scrollLeft <= 1, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 1 };
    setEdges(current => current.overflow === next.overflow && current.start === next.start && current.end === next.end ? current : next);
  }, []);
  // Scrolls the row just enough to show the active tab, without moving anything around it.
  const reveal = useCallback((id: string | undefined) => {
    const element = strip.current, tab = id && element?.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(id)}"]`);
    if (!element || !tab) return;
    const row = element.getBoundingClientRect(), box = tab.getBoundingClientRect(), margin = 24;
    if (box.left < row.left) element.scrollLeft -= row.left - box.left + margin;
    else if (box.right > row.right) element.scrollLeft += box.right - row.right + margin;
  }, []);
  const shownRef = useRef(shown); shownRef.current = shown;
  useEffect(() => {
    const element = strip.current; if (!element) return;
    let first = true;
    const observer = new ResizeObserver(() => { if (first) { first = false; reveal(shownRef.current); } measure(); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, reveal]);
  // Only a new active tab or a new count moves the row; renames and edits just re-measure it.
  useLayoutEffect(() => { reveal(shown); measure(); }, [shown, tabs.length, reveal, measure]);
  const widths = tabs.map(tab => `${tab.name}\u0000${minutesSeconds(tab.duration)}\u0000${tab.agents?.length ?? 0}`).join('\u0001');
  useLayoutEffect(measure, [widths, measure]);
  const page = (direction: -1 | 1) => { const element = strip.current; if (element) element.scrollLeft += direction * Math.max(element.clientWidth - 48, 80); };
  const open = (id: string) => { if (id === shown || busy) return; setOpening(id); void run(() => actions.onOpen(id)).finally(() => setOpening(null)); };
  const openRef = useRef(open); openRef.current = open;
  const [listOpen, setListOpen] = useState(false);
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  // Ctrl/Cmd+Alt+[ and ] open the previous and next timeline.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.altKey || !(event.ctrlKey || event.metaKey) || event.shiftKey) return;
      if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.isContentEditable || target?.closest('input,textarea,select,[role="dialog"]')) return;
      event.preventDefault();
      const list = tabsRef.current, index = list.findIndex(tab => tab.id === shownRef.current);
      const next = list[index + (event.code === 'BracketLeft' ? -1 : 1)];
      if (next) openRef.current(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Tabs scroll inside their own slot; the add button sits outside it, so it is always on screen.
  return <div className="timeline-tabs">
    {edges.overflow && <Tooltip><TooltipTrigger asChild><button type="button" className="timeline-tab-step" aria-label="Scroll timelines left" disabled={edges.start} onClick={() => page(-1)}><ChevronLeft size={14}/></button></TooltipTrigger><TooltipContent>Scroll left · previous timeline {shortcut('[')}</TooltipContent></Tooltip>}
    <div ref={strip} className="timeline-tabs-scroll" role="tablist" aria-label="Timelines" onScroll={measure}>
    {tabs.map(tab => { const isShown = tab.id === shown; return <div key={tab.id} className="timeline-tab" data-tab-id={tab.id} role="tab" aria-selected={isShown} data-active={isShown || undefined} data-working={!!tab.agents?.length || tab.id === workingId || undefined} data-done={tab.id === doneId && tab.id !== workingId || undefined}>
      <button type="button" className="timeline-tab-main" disabled={!tab.active && busy} title={!tab.active && locked ? `View ${tab.name} while the AI edits; it opens for editing when the edit finishes` : tab.name} onClick={() => { if (!tab.active) open(tab.id); }} onDoubleClick={() => { if (tab.active && !locked) setDialog({ mode: 'rename', id: tab.id, name: tab.name }); }}>
        {tab.agents?.length ? <WorkingAgents agents={tab.agents}/> : tab.id === workingId ? <span className="timeline-tab-agent" aria-hidden="true"><AgentLogo name={agentName} /></span> : null}
        <span className="timeline-tab-name">{tab.name}</span>
        <span className="timeline-tab-length">{minutesSeconds(tab.duration)}</span>
      </button>
      {<DropdownMenu><DropdownMenuTrigger className="timeline-tab-menu" aria-label={`Options for ${tab.name}`} tabIndex={isShown ? 0 : -1} aria-hidden={!isShown || undefined} disabled={!isShown}><ChevronDown size={12}/></DropdownMenuTrigger><DropdownMenuContent align="start" className="timeline-tab-options">
        <DropdownMenuItem disabled={locked} onSelect={() => setDialog({ mode: 'rename', id: tab.id, name: tab.name })}><Pencil/>Rename</DropdownMenuItem>
        <DropdownMenuItem disabled={blocked} onSelect={() => void run(() => actions.onCreate('duplicate'))}><Copy/>Duplicate</DropdownMenuItem>
        {actions.onExport && <DropdownMenuItem onSelect={() => actions.onExport?.(tab.id)}><Download/>Export this video</DropdownMenuItem>}
        {actions.onPost && <DropdownMenuItem disabled={postLocked || !tab.duration} onSelect={() => actions.onPost?.(tab.id)}><Send/>Post this video</DropdownMenuItem>}
        <DropdownMenuSeparator/>
        <DropdownMenuItem variant="destructive" disabled={blocked || tabs.length <= 1} onSelect={() => setDialog({ mode: 'remove', id: tab.id, name: tab.name })}><Trash2/>Delete timeline</DropdownMenuItem>
      </DropdownMenuContent></DropdownMenu>}
    </div>; })}
    </div>
    {edges.overflow && <Tooltip><TooltipTrigger asChild><button type="button" className="timeline-tab-step" aria-label="Scroll timelines right" disabled={edges.end} onClick={() => page(1)}><ChevronRight size={14}/></button></TooltipTrigger><TooltipContent>Scroll right · next timeline {shortcut(']')}</TooltipContent></Tooltip>}
    {edges.overflow && <Popover open={listOpen} onOpenChange={setListOpen}><Tooltip><TooltipTrigger asChild><PopoverTrigger className="timeline-tab-step" aria-label={`All ${tabs.length} timelines`}><List size={14}/></PopoverTrigger></TooltipTrigger><TooltipContent>All {tabs.length} timelines · {shortcut('[')} {shortcut(']')} to step</TooltipContent></Tooltip>
      <PopoverContent align="end" className="timeline-tab-list"><Command loop defaultValue={shown} filter={(_value, search, keywords) => keywords?.some(name => name.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0}>
        {tabs.length > SEARCH_FROM && <CommandInput placeholder="Find a timeline" aria-label="Find a timeline"/>}
        <CommandList><CommandEmpty>No timeline matches</CommandEmpty>
          {tabs.map(tab => <CommandItem key={tab.id} value={tab.id} keywords={[tab.name]} data-checked={tab.id === shown} disabled={busy && tab.id !== shown} onSelect={() => { setListOpen(false); open(tab.id); }}>
            <span className="timeline-tab-list-name">{tab.name}</span><span className="timeline-tab-length">{minutesSeconds(tab.duration)}</span>
          </CommandItem>)}
        </CommandList>
      </Command></PopoverContent></Popover>}
    <button type="button" className="timeline-tab-add" aria-label="New blank timeline" title="New blank timeline" disabled={blocked} onClick={() => void run(() => actions.onCreate('blank'))}><Plus size={14}/></button>
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
