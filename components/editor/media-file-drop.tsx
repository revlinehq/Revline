'use client';
import { userError } from '@/lib/user-error';

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import './media-file-drop.css';

// Capture external files before a nested timeline, composer, or empty-state
// drop handler can consume them. Internal asset/clip drags keep their own path.
export function useMediaFileDrop({ busy, onUpload, onError }: {
  busy: boolean;
  onUpload: (files: File[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const uploading = useRef(false);
  const reset = useCallback(() => { depth.current = 0; setActive(false); }, []);
  useEffect(() => {
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
      window.removeEventListener('blur', reset);
    };
  }, [reset]);
  const external = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  return {
    active,
    handlers: {
      onDragEnterCapture(event: DragEvent) {
        if (!external(event)) return;
        event.preventDefault();
        depth.current++;
        setActive(true);
      },
      onDragOverCapture(event: DragEvent) {
        if (!external(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = busy || uploading.current ? 'none' : 'copy';
        setActive(true);
      },
      onDragLeaveCapture(event: DragEvent) {
        if (!external(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) reset();
      },
      onDropCapture(event: DragEvent) {
        if (!external(event)) return;
        event.preventDefault();
        event.stopPropagation();
        reset();
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        if (busy || uploading.current) {
          onError('Wait for this upload to finish before adding more footage.');
          return;
        }
        uploading.current = true;
        void onUpload(files).catch(error => onError(userError(error, 'Could not import these files.'))).finally(() => { uploading.current = false; });
      },
    },
  };
}

export function MediaFileDropOverlay({ active, busy }: { active: boolean; busy: boolean }) {
  if (!active) return null;
  return <div className="editor-file-drop-overlay" role="status">
    <div><Upload size={30}/><strong>{busy ? 'An upload is already in progress' : 'Drop files into Sources'}</strong><span>{busy ? 'Let it finish, then drop your files again.' : 'Video, images, and audio — ready to use in your edit.'}</span></div>
  </div>;
}
