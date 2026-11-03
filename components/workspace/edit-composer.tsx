'use client';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { FootageProgressBar } from '@/components/editor/footage-progress-bar';
import { Card } from '@/components/ui/card';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { EDITOR_SLASH_COMMANDS, parseEditorCommand, type EditorCommandName } from '@/lib/ai/slash-commands';
import { userError } from '@/lib/user-error';

import { createContext, useContext, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Film, LoaderCircle, Music2, Plus, Square, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import './composer-upload-swap.css';

// Scoped by EditorShell so custom conversation panels share the active timeline control.
export const EditComposerHeaderContext = createContext<ReactNode>(null);

export type ComposerAttachment = { id: string; name: string; url?: string; kind?: 'video' | 'image' | 'audio' | 'model'; progress?: number; error?: string };
export type EditComposerProps = {
  value: string; onChange: (value: string) => void; onSubmit: () => void | Promise<void>;
  attachControl?: ReactNode; onAttach?: () => void; attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void;
  placeholder?: string; disabled?: boolean; running?: boolean; allowQueue?:boolean; onStop?: () => void | Promise<void>; stopping?: boolean;
  className?: string; variant?: 'landing' | 'studio' | 'compact'; attachmentLimit?: number; emptyHint?: string;
  header?: ReactNode; slashCommands?: boolean; actions?: ReactNode; submitLabel?: string; statusLabel?: string; uploadOnHover?: boolean; uploadState?: 'dragging'; requireMedia?: boolean;
};

export function EditComposer({ value, onChange, onSubmit, attachControl, onAttach, attachments = [], onRemoveAttachment, placeholder = 'Describe your next edit…', disabled = false, running = false, allowQueue=false, onStop, stopping: stoppingRequest = false, className, variant = 'studio', attachmentLimit = 2, emptyHint, actions, submitLabel, statusLabel, uploadOnHover = false, uploadState, requireMedia = false, slashCommands = false, header: suppliedHeader }: EditComposerProps) {
  const timelineHeader = useContext(EditComposerHeaderContext);
  const header = suppliedHeader ?? timelineHeader;
  const commandListId = useId();
  const [commandDismissed, setCommandDismissed] = useState(false);
  const [activeCommand, setActiveCommand] = useState<EditorCommandName>('clip');
  const commandPrefix = slashCommands ? /^\/(clip|inspo-motion)\s+/.exec(value) : null;
  const chosenCommand = commandPrefix?.[1];
  const commandQuery = slashCommands && !chosenCommand && /^\/[^\s]*$/.test(value) ? value.slice(1).toLowerCase() : null;
  const commands = commandQuery === null ? [] : EDITOR_SLASH_COMMANDS.filter(command => command.name.startsWith(commandQuery));
  const highlightedCommand = commands.find(command => command.name === activeCommand) ?? commands[0];
  const menuOpen = !commandDismissed && commands.length > 0;
  function changeInput(next: string) {
    setCommandDismissed(false);
    if (next === '/') setActiveCommand('clip');
    setError('');
    onChange(next);
  }
  function chooseCommand(name: EditorCommandName) {
    onChange(`/${name} `);
    setCommandDismissed(false);
    textarea.current?.focus({ preventScroll: true });
  }
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const sendInFlight=useRef(false);
  const [stopInFlight,setStopInFlight]=useState(false);
  const stopping=stoppingRequest||stopInFlight;
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fieldsFocused, setFieldsFocused] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const attachmentCount = useRef(attachments.length);
  const mediaPending = requireMedia && attachments.some(attachment => attachment.progress !== undefined && attachment.progress < 100 && !attachment.error);
  const busy = sending || disabled || mediaPending;
  const mediaMissing = requireMedia && attachments.length === 0;
  const attachmentError = attachments.find(attachment => attachment.error);
  const mediaInvalid = requireMedia && !!attachmentError;
  const showUpload = attachments.length === 0 && !!onAttach && !busy && !running && (!!uploadState || (uploadOnHover && hovered && (mediaMissing || (!editing && !fieldsFocused))));
  useLayoutEffect(() => {
    if (!mediaMissing) return;
    textarea.current?.blur();
    setEditing(false);
    setFieldsFocused(false);
  }, [mediaMissing]);
  useEffect(() => {
    if (uploadOnHover && attachments.length > attachmentCount.current) {
      setEditing(true);
      textarea.current?.focus({ preventScroll: true });
    }
    attachmentCount.current = attachments.length;
  }, [attachments.length, uploadOnHover]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field || variant === 'compact' && CSS.supports('field-sizing', 'content')) return;
    const resize = () => {
      // Measure the typed text only: Chromium counts placeholder text in scrollHeight, and the
      // placeholder changes while a reply runs (the longer queue hint), which made the box jump.
      const placeholder = field.placeholder; field.placeholder = '';
      field.style.height = '0px';
      const scrollHeight = field.scrollHeight; field.placeholder = placeholder;
      const height = Math.min(180, Math.max(variant === 'landing' ? 40 : variant==='compact'?24:38, scrollHeight));
      field.style.height = `${height}px`;
      field.style.overflowY = scrollHeight > height ? 'auto' : 'hidden';
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return;
      width = field.clientWidth; resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value, variant]);
  useLayoutEffect(() => {
    if (!uploadOnHover || !fields.current) return;
    const content = fields.current;
    const form = content.parentElement;
    if (!form) return;
    function resize() {
      const style = getComputedStyle(form!);
      const height = content.getBoundingClientRect().height + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      form!.style.height = `${height}px`;
    }
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(content);
    return () => { observer.disconnect(); form.style.removeProperty('height'); };
  }, [uploadOnHover]);
  async function stop() { if (stopping) return; setError(''); setStopInFlight(true); try { await onStop?.(); } catch (e) { setError(userError(e, 'Could not stop this edit.')); } finally { setStopInFlight(false); } }
  async function submit() {
    if (sendInFlight.current || busy || (running&&!allowQueue) || mediaMissing || mediaInvalid || (variant !== 'landing' && !value.trim() && !attachments.length)) return;
    if (slashCommands) {
      try { parseEditorCommand(value); } catch (e) { setError(userError(e, 'Check your command.')); return; }
    }
    sendInFlight.current=true;setSending(true); setError('');
    try { await onSubmit(); } catch (e) { setError(userError(e, 'Could not send your edit.')); } finally { sendInFlight.current=false;setSending(false); }
  }
  function chip(attachment: ComposerAttachment) {
    return <div className="composer-attachment" key={attachment.id} data-error={!!attachment.error || undefined}>{attachment.url && attachment.kind !== 'audio' && attachment.kind !== 'model' ? attachment.kind === 'video' ? <video src={attachment.url} muted preload="metadata" aria-hidden="true" /> : <img src={attachment.url} alt="" /> : attachment.kind === 'audio' ? <Music2 size={17} /> : <Film size={17} />}<span>{attachment.name}</span>{attachment.progress !== undefined && <FootageProgressBar progressKey={`asset:${attachment.id}`} label={`Preparing ${attachment.name}`} value={attachment.progress} />}{onRemoveAttachment && <InputGroupButton size="icon-xs" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`} disabled={busy || (running&&!allowQueue)}><X /></InputGroupButton>}</div>;
  }
  const editFields = <>
    <Popover open={menuOpen && !busy && fieldsFocused} onOpenChange={open => { if (!open) setCommandDismissed(true); }}>
    <PopoverAnchor asChild><InputGroup className="composer-input-group border-[#363636] bg-[#2a2a2a]">
    {!!attachments.length && <InputGroupAddon align="block-start" className="composer-attachments">{attachments.slice(0, attachmentLimit).map(chip)}{attachments.length > attachmentLimit && <InputGroupButton variant="secondary" onClick={() => setSheetOpen(true)}>+{attachments.length - attachmentLimit} clips</InputGroupButton>}</InputGroupAddon>}
    <InputGroupTextarea ref={textarea} className="min-h-14 px-3.5 pt-2.5" aria-label="Describe your next edit" placeholder={mediaMissing ? 'Drop in media to start chatting' : chosenCommand === 'inspo-motion' ? 'Paste a video link and optional direction…' : chosenCommand === 'clip' ? 'Add a video link or use project footage…' : placeholder} value={value} maxLength={2000} rows={variant==='compact'?1:2} aria-disabled={busy || undefined} readOnly={mediaMissing || busy} onPointerDown={e => { if (mediaMissing) { e.preventDefault(); onAttach?.(); } }} onChange={e => { if (!mediaMissing && !busy) changeInput(e.target.value); }} aria-expanded={slashCommands ? menuOpen && fieldsFocused && !busy : undefined} aria-haspopup={slashCommands ? "listbox" : undefined} aria-controls={menuOpen && fieldsFocused && !busy ? commandListId : undefined} aria-activedescendant={menuOpen && fieldsFocused && !busy && highlightedCommand ? `${commandListId}-${highlightedCommand.name}` : undefined} onKeyDown={e => {
      if (menuOpen && highlightedCommand && !e.nativeEvent.isComposing) {
        if (e.key === 'Escape') { e.preventDefault(); setCommandDismissed(true); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const index = commands.indexOf(highlightedCommand); setActiveCommand(commands[(index + (e.key === 'ArrowDown' ? 1 : commands.length - 1)) % commands.length].name); return; }
        if (e.key === 'Tab' || e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chooseCommand(highlightedCommand.name); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (mediaMissing) onAttach?.(); else void submit(); } }} />
    <InputGroupAddon align="block-end" className="edit-composer-actions pt-1 pl-1.5 pr-2">{attachControl ?? (statusLabel ? <InputGroupText className="composer-status">{statusLabel}</InputGroupText> : emptyHint && !attachments.length ? <InputGroupButton size="sm" className="composer-empty-hint" onClick={onAttach}>{emptyHint}</InputGroupButton> : <InputGroupButton size="icon-sm" className="composer-add" aria-label="Add footage" onClick={onAttach} disabled={!onAttach || busy}><Plus /></InputGroupButton>)}{actions}{running && onStop && (!allowQueue||!value.trim()) ? <InputGroupButton variant="default" size="icon-sm" className="revline-primary composer-submit ml-auto" disabled={stopping} onClick={event => { event.preventDefault(); void stop(); }} aria-label={stopping ? 'Stopping edit' : 'Stop editing'}><Square /></InputGroupButton> : <InputGroupButton variant="default" type="submit" size={submitLabel ? 'sm' : 'icon-sm'} className="revline-primary composer-submit ml-auto" disabled={busy || (running&&!allowQueue) || mediaMissing || mediaInvalid || (variant !== 'landing' && !value.trim() && !attachments.length)} aria-label={running&&allowQueue?'Queue message':submitLabel ?? 'Start edit'}>{submitLabel}{sending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</InputGroupButton>}</InputGroupAddon>
    </InputGroup></PopoverAnchor>
    <PopoverContent side="top" align="start" sideOffset={8} className="w-[min(340px,calc(100vw-32px))] border border-[#414141] bg-[#2a2a2a] p-1 text-neutral-100 ring-0" onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()} onInteractOutside={event => { if (event.target === textarea.current) event.preventDefault(); }}>
      <Command shouldFilter={false} value={highlightedCommand?.name ?? ''} onValueChange={name => { const command = commands.find(item => item.name === name); if (command) setActiveCommand(command.name); }} className="bg-[#2a2a2a] text-neutral-100">
        <CommandList id={commandListId} aria-label="Editor slash commands">{commands.map(command => <CommandItem id={`${commandListId}-${command.name}`} key={command.name} value={command.name} onMouseDown={event => event.preventDefault()} onSelect={() => chooseCommand(command.name)} className="flex cursor-pointer flex-col items-start gap-0.5 px-2.5 py-2 [&>svg]:hidden data-[selected=true]:bg-[#3a3a3a] data-[selected=true]:text-white"><span className="text-sm font-medium">/{command.name}</span><span className="text-xs text-neutral-400">{command.note}</span></CommandItem>)}</CommandList>
      </Command>
    </PopoverContent></Popover>
    {(error || attachmentError) && <p className="composer-error" role="alert">{error || `${attachmentError!.name}: ${attachmentError!.error}`}</p>}
  </>;
  return <><form className={cn('edit-composer', `edit-composer-${variant}`, attachments.length && 'has-attachments', 'composer-upload-enabled', header && 'has-composer-header', uploadOnHover && 'composer-height-transition', className)} data-upload-view={showUpload || undefined} onPointerEnter={e => { if (uploadOnHover && e.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => { if (uploadOnHover) { setHovered(false); setEditing(false); } }} onSubmit={e => { e.preventDefault(); if (!showUpload) void submit(); }} aria-label="Edit request">
    {header && <Card className="composer-header" role="group" aria-label="Video settings">{header}</Card>}
    <div ref={fields} className="composer-edit-fields" aria-hidden={showUpload || undefined} inert={showUpload} onFocusCapture={() => setFieldsFocused(true)} onBlurCapture={e => { if (!fields.current?.contains(e.relatedTarget as Node | null)) setFieldsFocused(false); }}>{editFields}</div>
    <div className="composer-upload-swap" aria-hidden={!showUpload} inert={!showUpload}>
      <button type="button" className="composer-new-video" onClick={() => { setEditing(true); onAttach?.(); }} disabled={busy} aria-label="New video: add footage">
        <span><Plus size={24} strokeWidth={2} aria-hidden="true" />{uploadState === 'dragging' ? 'Drop your footage' : 'New video'}<span className="composer-video-badge">AI</span></span>
      </button>
    </div>
  </form><Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="composer-media-sheet" onCloseAutoFocus={event => { event.preventDefault(); textarea.current?.focus({ preventScroll: true }); }}><SheetTitle>Your footage</SheetTitle><SheetDescription>{attachments.length ? 'Clips attached to this conversation.' : 'Add footage to continue your edit.'}</SheetDescription><div className="composer-sheet-attachments">{attachments.map(chip)}</div><EditComposer slashCommands={slashCommands} requireMedia={mediaMissing} value={value} onChange={onChange} onSubmit={async () => { if (mediaMissing || mediaInvalid) return; await onSubmit(); setSheetOpen(false); }} onAttach={onAttach} actions={actions} running={running} allowQueue={allowQueue} disabled={disabled} onStop={onStop} /></SheetContent></Sheet></>;
}
