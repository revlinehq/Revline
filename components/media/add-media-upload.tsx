'use client';

import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { Link2, LoaderCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useVideoLinkImport } from '@/components/editor/video-link-import';
import './add-media-upload.css';

type Page = 'upload' | 'link';
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
const LINK_NOTE = 'YouTube videos and Shorts, TikTok videos, and Instagram reels and posts. Twitch, X and direct video links work too.';

/** The body of an "Add media" modal: a drop zone with a file picker, and a field that imports a video link
 *  (YouTube, TikTok, Instagram…) through the regular link importer, with its error messages. No dialog chrome, so any
 *  Add media modal can hold it: the Library's shows it as two pages (`layout="pages"`), and a modal whose own nav already
 *  says "Upload" can show the drop zone above the link field (`layout="stacked"`). Styled with the dashboard tokens,
 *  falling back to the editor's. The caller decides where files and links go:
 *  - `onUpload` gets the chosen or dropped files;
 *  - `onImportLink` gets a checked link URL and resolves once the import is accepted (a refusal is shown in the field).
 *  Call `onDone` to close the modal after either. */
export function AddMediaUpload({ onUpload, onImportLink, onDone, onBusyChange, layout = 'pages', place, linkNote, disabled = false }: {
  onUpload: (files: File[]) => void; onImportLink: (url: string) => Promise<void>; onDone?: () => void;
  /** True while a link import is being started: the modal should not close then. */
  onBusyChange?: (busy: boolean) => void;
  layout?: 'pages' | 'stacked';
  /** Where files go, for the file picker's label ("the Library", a folder name, "this project"). */
  place?: string;
  /** Added after the supported-sites note under the link field. */
  linkNote?: string;
  disabled?: boolean;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<Page>('upload'), [dragging, setDragging] = useState(false);
  const link = useVideoLinkImport(async url => { await onImportLink(url); onDone?.(); }, disabled);
  const busy = disabled || link.busy;
  useEffect(() => { onBusyChange?.(link.busy); }, [link.busy, onBusyChange]);
  function attach(files: File[]) { setDragging(false); if (busy || !files.length) return; onDone?.(); onUpload(files); }

  const drop = <button type="button" className="add-media-upload-drop" data-dragging={dragging || undefined} disabled={busy} onClick={() => input.current?.click()}>
    <Upload aria-hidden="true" /><strong>{dragging ? 'Drop your files here' : 'Drag and drop your files'}</strong><span>or click to browse</span><small>Video, images and audio</small>
  </button>;
  const form = <form className="add-media-upload-link" onSubmit={event => { event.preventDefault(); void link.submit(); }}>
    <label htmlFor={id} className={layout === 'pages' ? 'sr-only' : 'add-media-upload-label'}>{layout === 'pages' ? 'Video link' : <><Link2 aria-hidden="true" />Paste a video link</>}</label>
    <div className="add-media-upload-field">
      <Input id={id} type="url" required autoFocus={layout === 'pages'} maxLength={2048} placeholder="Paste a YouTube, TikTok or Instagram link" autoComplete="off" spellCheck={false} value={link.url} disabled={busy} aria-invalid={!!link.error} aria-describedby={`${id}-hint${link.error ? ` ${id}-error` : ''}`} onChange={event => link.change(event.target.value)} />
      <Button type="submit" variant="primary" disabled={busy || !link.url.trim()}>{link.busy ? <LoaderCircle className="animate-spin" aria-label="Starting import" /> : 'Import'}</Button>
    </div>
    <p id={`${id}-hint`} className="add-media-upload-note">{linkNote ? `${LINK_NOTE} ${linkNote}` : LINK_NOTE}</p>
    {link.error && <p id={`${id}-error`} className="add-media-upload-error" role="alert">{link.error}</p>}
  </form>;

  return <div className="add-media-upload" data-layout={layout}
    onDragEnter={event => { if (hasFiles(event)) event.stopPropagation(); }}
    onDragOver={event => { if (!hasFiles(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy'; if (!busy) { setDragging(true); setPage('upload'); } }}
    onDragLeave={event => { event.stopPropagation(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
    onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); event.stopPropagation(); attach(Array.from(event.dataTransfer.files)); }}>
    {layout === 'pages' ? <Tabs value={page} onValueChange={value => setPage(value as Page)} className="add-media-upload-tabs">
      <TabsList className="add-media-upload-pages" aria-label="Add media from">
        <TabsTrigger value="upload" disabled={link.busy}><Upload aria-hidden="true" />Upload</TabsTrigger>
        <TabsTrigger value="link"><Link2 aria-hidden="true" />Paste a link</TabsTrigger>
      </TabsList>
      <TabsContent value="upload">{drop}</TabsContent>
      <TabsContent value="link">{form}</TabsContent>
    </Tabs> : <>{drop}{form}</>}
    <input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label={place ? `Choose files to upload to ${place}` : 'Choose files to upload'} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; attach(files); }} />
  </div>;
}
