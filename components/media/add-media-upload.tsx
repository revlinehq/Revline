'use client';

import { useId, useRef } from 'react';
import { LoaderCircle, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVideoLinkImport } from '@/components/editor/video-link-import';
import './add-media-upload.css';

export const MEDIA_ACCEPT = 'video/*,audio/*,image/*';

/** The Upload page of an Add media dialog, built to be shared by the editor's and the Library's: a large drop zone that browses for files,
 * and under it a Paste URL field that sends YouTube, TikTok and Instagram links through the regular link importer.
 * The dialog around it owns drag-and-drop over its whole surface and passes `dragging` in. */
export function AddMediaUpload({ onFiles, onImportLink, dragging = false, disabled = false, disabledReason, linkHint, linkUnavailable }: {
  /** Chosen or dropped files; the caller closes its dialog and starts the upload. */
  onFiles: (files: File[]) => void;
  /** Resolves once the import is accepted; omitted where links cannot be imported. */
  onImportLink?: (url: string) => Promise<void>;
  dragging?: boolean; disabled?: boolean;
  /** Said in the drop zone while it is disabled. */disabledReason?: string;
  /** Said in place of the link field when links cannot be imported right now. */linkUnavailable?: string;
  /** One line under the field: where the imported video goes. */
  linkHint?: string;
}) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const link = useVideoLinkImport(async url => { await onImportLink?.(url); });
  return <div className="add-media-upload">
    <Button type="button" variant="outline" className="add-media-drop" data-dragging={dragging || undefined} disabled={disabled || link.busy} onClick={() => input.current?.click()}>
      <Upload aria-hidden="true"/>
      <strong>{dragging ? 'Drop your files here' : 'Upload'}</strong>
      <span>{disabled && disabledReason ? disabledReason : 'Drag and drop, or click to browse'}</span>
      <small>Video, images and audio</small>
    </Button>
    <input ref={input} type="file" accept={MEDIA_ACCEPT} multiple className="sr-only" tabIndex={-1} aria-label="Choose files to upload" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) onFiles(files); }}/>
    {onImportLink && <form className="add-media-link" onSubmit={event => { event.preventDefault(); void link.submit(); }}>
      <label htmlFor={id} className="sr-only">Paste URL</label>
      <div className="add-media-link-field">
        <Input id={id} type="url" required maxLength={2048} placeholder="Paste URL: YouTube, TikTok or Instagram" autoComplete="off" spellCheck={false} value={link.url} disabled={link.busy} aria-invalid={!!link.error} aria-describedby={`${id}-hint${link.error ? ` ${id}-error` : ''}`} onChange={event => link.change(event.target.value)}/>
        <Button type="submit" disabled={link.busy || !link.url.trim()}>{link.busy ? <LoaderCircle className="animate-spin" aria-label="Starting import"/> : 'Import'}</Button>
      </div>
      <p id={`${id}-hint`} className="add-media-note">{linkHint ?? 'Public videos up to 3 hours. Twitch, X and direct video links work too.'}</p>
      {link.error && <p id={`${id}-error`} className="add-media-error" role="alert">{link.error}</p>}
    </form>}
    {!onImportLink && linkUnavailable && <p className="add-media-note">{linkUnavailable}</p>}
  </div>;
}
