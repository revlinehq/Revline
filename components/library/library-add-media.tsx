'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AddMediaUpload } from '@/components/media/add-media-upload';

/** The Library's Add media dialog. Its body (Upload and Paste a link) is the shared `AddMediaUpload`. */
export function AddMediaDialog({ place, onClose, onUpload, onImportLink }: {
  place: string; onClose: () => void; onUpload: (files: File[]) => void; onImportLink: (url: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    {/* A file let go outside the body is ignored rather than opened by the browser or the page behind. */}
    <DialogContent className="library-dialog library-add-media" onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); }}>
      <DialogTitle>Add media</DialogTitle>
      <DialogDescription>Upload files or save a video from a link to {place}.</DialogDescription>
      <AddMediaUpload place={place} linkNote="The video is saved to your Library for later." onUpload={onUpload} onImportLink={onImportLink} onDone={onClose} onBusyChange={setBusy} />
    </DialogContent>
  </Dialog>;
}
