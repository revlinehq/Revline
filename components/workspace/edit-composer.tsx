'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Film, LoaderCircle, Music2, Plus, Square, X } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { FilledPlayIcon, PrimaryButton } from './primary-button';
import { cn } from '@/lib/utils';
import './composer-upload-swap.css';

export type ComposerAttachment = { id: string; name: string; url?: string; kind?: 'video' | 'image' | 'audio'; progress?: number; error?: string };
export type EditComposerProps = {
  value: string; onChange: (value: string) => void; onSubmit: () => void | Promise<void>;
  onAttach?: () => void; attachments?: ComposerAttachment[]; onRemoveAttachment?: (id: string) => void;
  placeholder?: string; disabled?: boolean; running?: boolean; onStop?: () => void | Promise<void>;
  className?: string; variant?: 'landing' | 'studio' | 'compact'; attachmentLimit?: number; emptyHint?: string;
  submitLabel?: string; statusLabel?: string; uploadOnHover?: boolean; uploadState?: 'dragging'; requireMedia?: boolean;
};

export function EditComposer({ value, onChange, onSubmit, onAttach, attachments = [], onRemoveAttachment, placeholder = 'Describe your next edit…', disabled = false, running = false, onStop, className, variant = 'studio', attachmentLimit = 2, emptyHint, submitLabel, statusLabel, uploadOnHover = false, uploadState, requireMedia = false }: EditComposerProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fieldsFocused, setFieldsFocused] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fields = useRef<HTMLDivElement>(null);
  const attachmentCount = useRef(attachments.length);
  const busy = sending || disabled;
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
      field.style.height = '0px';
      const height = Math.min(180, Math.max(variant === 'landing' ? 40 : variant==='compact'?24:38, field.scrollHeight));
      field.style.height = `${height}px`;
      field.style.overflowY = field.scrollHeight > height ? 'auto' : 'hidden';
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
  async function stop() { setError(''); try { await onStop?.(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not stop this edit.'); } }
  async function submit() {
    if (busy || running || mediaMissing || mediaInvalid || (variant !== 'landing' && !value.trim() && !attachments.length)) return;
    setSending(true); setError('');
    try { await onSubmit(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not send your edit.'); } finally { setSending(false); }
  }
  function chip(attachment: ComposerAttachment) {
    return <div className="composer-attachment" key={attachment.id} data-error={!!attachment.error || undefined}>{attachment.url && attachment.kind !== 'audio' ? attachment.kind === 'video' ? <video src={attachment.url} muted preload="metadata" aria-hidden="true" /> : <img src={attachment.url} alt="" /> : attachment.kind === 'audio' ? <Music2 size={17} /> : <Film size={17} />}<span title={attachment.name}>{attachment.name}</span>{attachment.progress !== undefined && <progress aria-label={`Uploading ${attachment.name}`} max={100} value={attachment.progress} />}{onRemoveAttachment && <button type="button" onClick={() => onRemoveAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`} disabled={busy || running}><X size={11} /></button>}</div>;
  }
  const editFields = <>
    {!!attachments.length && <div className="composer-attachments">{attachments.slice(0, attachmentLimit).map(chip)}{attachments.length > attachmentLimit && <button className="composer-more" type="button" onClick={() => setSheetOpen(true)}>+{attachments.length - attachmentLimit} clips</button>}</div>}
    <textarea ref={textarea} aria-label="Describe your next edit" placeholder={mediaMissing ? 'Drop in media to start chatting' : placeholder} value={value} maxLength={2000} rows={variant==='compact'?1:2} disabled={busy} readOnly={mediaMissing} onPointerDown={e => { if (mediaMissing) { e.preventDefault(); onAttach?.(); } }} onChange={e => { if (!mediaMissing) onChange(e.target.value); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (mediaMissing) onAttach?.(); else void submit(); } }} />
    <div className="edit-composer-actions">{statusLabel ? <span className="composer-status">{statusLabel}</span> : emptyHint && !attachments.length ? <button type="button" className="composer-empty-hint" onClick={onAttach}>{emptyHint}</button> : <button type="button" className="composer-add" aria-label="Add footage" title="Add footage" onClick={onAttach} disabled={!onAttach || busy}><Plus size={16} /></button>}<span className="composer-action-space" />{running && onStop ? <PrimaryButton type="button" size="icon" onClick={() => void stop()} aria-label="Stop editing"><Square size={12} /></PrimaryButton> : <PrimaryButton type="submit" size={submitLabel ? 'default' : 'icon'} disabled={busy || running || mediaMissing || mediaInvalid || (variant !== 'landing' && !value.trim() && !attachments.length)} aria-label={submitLabel ?? 'Start edit'}>{submitLabel}{sending ? <LoaderCircle size={14} className="animate-spin" /> : variant==='compact'?<ArrowUp size={16}/>:<FilledPlayIcon />}</PrimaryButton>}</div>
    {(error || attachmentError) && <p className="composer-error" role="alert">{error || `${attachmentError!.name}: ${attachmentError!.error}`}</p>}
  </>;
  return <><form className={cn('edit-composer', `edit-composer-${variant}`, attachments.length && 'has-attachments', 'composer-upload-enabled', uploadOnHover && 'composer-height-transition', className)} data-upload-view={showUpload || undefined} onPointerEnter={e => { if (uploadOnHover && e.pointerType !== 'touch') setHovered(true); }} onPointerLeave={() => { if (uploadOnHover) { setHovered(false); setEditing(false); } }} onSubmit={e => { e.preventDefault(); if (!showUpload) void submit(); }} aria-label="Edit request">
    <div ref={fields} className="composer-edit-fields" aria-hidden={showUpload || undefined} inert={showUpload} onFocusCapture={() => setFieldsFocused(true)} onBlurCapture={e => { if (!fields.current?.contains(e.relatedTarget as Node | null)) setFieldsFocused(false); }}>{editFields}</div>
    <div className="composer-upload-swap" aria-hidden={!showUpload} inert={!showUpload}>
      <button type="button" className="composer-new-video" onClick={() => { setEditing(true); onAttach?.(); }} disabled={busy} aria-label="New video — add footage">
        <span><Plus size={24} strokeWidth={2} aria-hidden="true" />{uploadState === 'dragging' ? 'Drop your footage' : 'New video'}<span className="composer-video-badge">AI</span></span>
      </button>
    </div>
  </form><Sheet open={sheetOpen} onOpenChange={setSheetOpen}><SheetContent className="composer-media-sheet" onCloseAutoFocus={event => { event.preventDefault(); textarea.current?.focus({ preventScroll: true }); }}><SheetTitle>Your footage</SheetTitle><SheetDescription>{attachments.length ? 'Clips attached to this conversation.' : 'Add footage to continue your edit.'}</SheetDescription><div className="composer-sheet-attachments">{attachments.map(chip)}</div><EditComposer requireMedia={mediaMissing} value={value} onChange={onChange} onSubmit={async () => { if (mediaMissing || mediaInvalid) return; await onSubmit(); setSheetOpen(false); }} onAttach={onAttach} running={running} disabled={disabled} onStop={onStop} /></SheetContent></Sheet></>;
}
