'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { Link2, LoaderCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useVideoLinkImport } from '@/components/editor/video-link-import';

type Page = 'upload' | 'link';
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/** The Library's Add media dialog: an Upload page (drop zone and file picker) and a Paste a link page, which saves a
 * YouTube, TikTok or Instagram video into the open folder through the regular link importer. */
export function AddMediaDialog({ place, onClose, onUpload, onImportLink }: {
  place: string; onClose: () => void; onUpload: (files: File[]) => void; onImportLink: (url: string) => Promise<void>;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState<Page>('upload'), [dragging, setDragging] = useState(false);
  // Resolves once the import is accepted; its progress then shows on the Library page.
  const link = useVideoLinkImport(async url => { await onImportLink(url); onClose(); });
  function attach(files: File[]) { setDragging(false); if (files.length) { onClose(); onUpload(files); } }
  return <Dialog open onOpenChange={open => { if (!open && !link.busy) onClose(); }}>
    <DialogContent className="library-dialog library-add-media" onDragEnter={event => { if (hasFiles(event)) event.stopPropagation(); }} onDragOver={event => { if (!hasFiles(event)) return; event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setDragging(true); setPage('upload'); }}
      onDragLeave={event => { event.stopPropagation(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }}
      onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); event.stopPropagation(); attach(Array.from(event.dataTransfer.files)); }}>
      <DialogTitle>Add media</DialogTitle>
      <DialogDescription>Upload files or save a video from a link to {place}.</DialogDescription>
      <Tabs value={page} onValueChange={value => setPage(value as Page)} className="library-add-media-tabs">
        <TabsList className="library-add-media-pages" aria-label="Add media from">
          <TabsTrigger value="upload" disabled={link.busy}><Upload aria-hidden="true" />Upload</TabsTrigger>
          <TabsTrigger value="link"><Link2 aria-hidden="true" />Paste a link</TabsTrigger>
        </TabsList>
        <TabsContent value="upload">
          <button type="button" className="library-add-media-drop" data-dragging={dragging || undefined} onClick={() => input.current?.click()}>
            <Upload aria-hidden="true" /><strong>{dragging ? 'Drop your files here' : 'Drag and drop your files'}</strong><span>or click to browse</span><small>Video, images and audio</small>
          </button>
        </TabsContent>
        <TabsContent value="link">
          <form className="library-add-media-link" onSubmit={event => { event.preventDefault(); void link.submit(); }}>
            <label htmlFor={id} className="sr-only">Video link</label>
            <div className="library-add-media-field">
              <Input id={id} type="url" required autoFocus maxLength={2048} placeholder="Paste a YouTube, TikTok or Instagram link" autoComplete="off" spellCheck={false} value={link.url} disabled={link.busy} aria-invalid={!!link.error} aria-describedby={`${id}-hint${link.error ? ` ${id}-error` : ''}`} onChange={event => link.change(event.target.value)} />
              <Button type="submit" variant="primary" disabled={link.busy || !link.url.trim()}>{link.busy ? <LoaderCircle className="animate-spin" aria-label="Starting import" /> : 'Import'}</Button>
            </div>
            <p id={`${id}-hint`} className="library-dialog-note">YouTube videos and Shorts, TikTok videos, and Instagram reels and posts. Twitch, X and direct video links work too. The video is saved to your Library for later.</p>
            {link.error && <p id={`${id}-error`} className="dash-error" role="alert">{link.error}</p>}
          </form>
        </TabsContent>
      </Tabs>
      <input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label={`Choose files to upload to ${place}`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; attach(files); }} />
    </DialogContent>
  </Dialog>;
}
