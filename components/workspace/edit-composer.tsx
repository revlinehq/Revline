'use client';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupText, InputGroupTextarea } from '@/components/ui/input-group';
import { userError } from '@/lib/user-error';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Film, LoaderCircle, Music2, Plus, Square, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import './composer-upload-swap.css';

export type ComposerAttachment = { id: string; name: string; url?: string; kind?: 'video' | 'image' | 'audio'; progress?: number; error?: string };
export type EditComposerProps = {
  value: string; onChange: (value: string) => void; onSubmit: () => void | Promise<void>;
  onAttach?: () => void; attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void;
  placeholder?: string; disabled?: boolean; running?: boolean; allowQueue?:boolean; onStop?: () => void | Promise<void>; stopping?: boolean;
  className?: string; variant?: 'landing' | 'studio' | 'compact'; attachmentLimit?: number; emptyHint?: string;
  actions?: ReactNode; submitLabel?: string; statusLabel?: string; uploadOnHover?: boolean; uploadState?: 'dragging'; requireMedia?: boolean;
};

export function EditComposer({ value, onChange, onSubmit, onAttach, attachments = [], onRemoveAttachment, placeholder = 'Describe your next edit…', disabled = false, running = false, allowQueue=false, onStop, stopping: stoppingRequest = false, className, variant = 'studio', attachmentLimit = 2, emptyHint, actions, submitLabel, statusLabel, uploadOnHover = false, uploadState, requireMedia = false }: EditComposerProps) {
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
    if (!field) return;
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
    sendInFlight.current=true;setSending(true); setError('');
    try { await onSubmit(); } catch (e) { setError(userError(e, 'Could not send your edit.')); } finally { sendInFlight.current=false;setSending(false); }
  }
  function chip(attachment: ComposerAttachment) {
    return <div className="composer-attachment" key={attachment.id} data-error={!!attachment.error || undefined}>{attachment.url && attachment.kind !== 'audio' ? attachment.kind === 'video' ? <video src={attachment.url} muted preload="metadata" aria-hidden="true" /> : <img src={attachment.url} alt="" /> : attachment.kind === 'audio' ? <Music2 size={17} /> : <Film size={17} />}<span>{attachment.name}</span>{attachment.progress !== undefined && <progress aria-label={`Uploading ${attachment.name}`} max={100} value={attachment.progress} />}{onRemoveAttachment && <InputGroupButton size="icon-xs" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`} disabled={busy || (running&&!allowQueue)}><X /></InputGroupButton>}</div>;
  }
  const editFields = <>
    <InputGroup className="composer-input-group border-[#363636] bg-[#2a2a2a]">
    {!!attachments.length && <InputGroupAddon align="block-start" className="composer-attachments">{attachments.slice(0, attachmentLimit).map(chip)}{attachments.length > attachmentLimit && <InputGroupButton variant="secondary" onClick={() => setSheetOpen(true)}>+{attachments.length - attachmentLimit} clips</InputGroupButton>}</InputGroupAddon>}
    <InputGroupTextarea ref={textarea} className="min-h-14 px-3.5 pt-2.5" aria-label="Describe your next edit" placeholder={mediaMissing ? 'Drop in media to start chatting' : placeholder} value={value} maxLength={2000} rows={variant==='compact'?1:2} aria-disabled={busy || undefined} readOnly={mediaMissing || busy} onPointerDown={e => { if (mediaMissing) { e.preventDefault(); onAttach?.(); } }} onChange={e => { if (!mediaMissing && !busy) onChange(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (mediaMissing) onAttach?.(); else void submit(); } }} />
    <InputGroupAddon align="block-end" className="edit-composer-actions pt-1 pl-1.5 pr-2">{statusLabel ? <InputGroupText className="composer-status">{statusLabel}</InputGroupText> : emptyHint && !attachments.length ? <InputGroupButton size="sm" className="composer-empty-hint" onClick={onAttach}>{emptyHint}</InputGroupButton> : <InputGroupButton size="icon-sm" className="composer-add" aria-label="Add footage" onClick={onAttach} disabled={!onAttach || busy}><Plus /></InputGroupButton>}{actions}{running && onStop && (!allowQueue||!value.trim()) ? <InputGroupButton variant="default" size="icon-sm" className="revline-primary composer-submit ml-auto" disabled={stopping} onClick={event => { event.preventDefault(); void stop(); }} aria-label={stopping ? 'Stopping edit' : 'Stop editing'}><Square /></InputGroupButton> : <InputGroupButton variant="default" type="submit" size={submitLabel ? 'sm' : 'icon-sm'} className="revline-primary composer-submit ml-auto" disabled={busy || (running&&!allowQueue) || mediaMissing || mediaInvalid || (variant !== 'landing' && !value.trim() && !attachments.length)} aria-label={running&&allowQueue?'Queue message':submitLabel ?? 'Start edit'}>{submitLabel}{sending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}</InputGroupButton>}</InputGroupAddon>
    </InputGroup>
    {(error || attachmentError) && <p className="composer-error" role="alert">{error || `${attachmentError!.name}: ${attachmentError!.error}`}</p>}
  </>;
  return <><form className={cn('edit-composer', `edit-composer-${variant}`, attachments.length && 'has-attachments', 'composer-upload-enabled', uploadOnHover && 'composer-height-transition', className)} data-upload-view={showUpload || undefined} onPointerEnter={e => { if (uploadOnHover && e.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => { if (uploadOnHover) { setHovered(false); setEditing(false); } }} onSubmit={e => { e.preventDefault(); if (!showUpload) void submit(); }} aria-label="Edit request">
    <div ref={fields} className="composer-edit-fields" aria-hidden={showUpload || undefined} inert={showUpload} onFocusCapture={() => setFieldsFocused(true)} onBlurCapture={e => { if (!fields.current?.contains(e.relatedTarget as Node | null)) setFieldsFocused(false); }}>{editFields}</div>
    <div className="composer-upload-swap" aria-hidden={!showUpload} inert={!showUpload}>
      <button type="button" className="composer-new-video" onClick={() => { setEditing(true); onAttach?.(); }} disabled={busy} aria-label="New video: add footage">
        <span><Plus size={24} strokeWidth={2} aria-hidden="true" />{uploadState === 'dragging' ? 'Drop your footage' : 'New video'}<span className="composer-video-badge">AI</span></span>
      </button>
    </div>
  </form><Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="composer-media-sheet" onCloseAutoFocus={event => { event.preventDefault(); textarea.current?.focus({ preventScroll: true }); }}><SheetTitle>Your footage</SheetTitle><SheetDescription>{attachments.length ? 'Clips attached to this conversation.' : 'Add footage to continue your edit.'}</SheetDescription><div className="composer-sheet-attachments">{attachments.map(chip)}</div><EditComposer requireMedia={mediaMissing} value={value} onChange={onChange} onSubmit={async () => { if (mediaMissing || mediaInvalid) return; await onSubmit(); setSheetOpen(false); }} onAttach={onAttach} actions={actions} running={running} allowQueue={allowQueue} disabled={disabled} onStop={onStop} /></SheetContent></Sheet></>;
}
