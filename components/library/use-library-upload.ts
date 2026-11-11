'use client';

import { useCallback, useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia } from '@/lib/editor/media';
import type { UploadActivity } from '@/lib/editor/multipart-upload';
import { backendLacks, startDirect, uploadResumable } from '@/lib/editor/upload-resume';
import { userError } from '@/lib/user-error';

export type UploadState = { kind: 'waiting' } | { kind: 'reading' } | { kind: 'uploading'; percent: number; activity?: UploadActivity } | { kind: 'saving' } | { kind: 'failed'; message: string };
export type UploadRow = { id: string; name: string; size: number; state: UploadState };
type Entry = { id: string; file: File; folderId?: Id<'storageFolders'>; controller: AbortController };
const MAX_FILES = 20;

/** Uploads files into the Library one after another. A finished file leaves the list (it shows among the files);
 * a failed one stays until it is retried or dismissed. */
export function useLibraryUpload() {
  const start = useAction(api.cloudMedia.start), startInFolder = useAction(api.cloudMedia.startInFolder), partUrl = useAction(api.cloudMedia.partUrl), partUrls = useAction(api.cloudMedia.partUrls);
  const resume = useAction(api.cloudMedia.resume), complete = useAction(api.cloudMedia.complete), abort = useAction(api.cloudMedia.abort);
  const [rows, setRows] = useState<UploadRow[]>([]), [error, setError] = useState('');
  const entries = useRef<Entry[]>([]), waiting = useRef<string[]>([]), running = useRef(false);
  const actions = useRef({ start, startInFolder, partUrl, partUrls, resume, complete, abort });
  actions.current = { start, startInFolder, partUrl, partUrls, resume, complete, abort };

  const update = (id: string, state: UploadState) => setRows(current => current.map(row => row.id === id ? { ...row, state } : row));
  const drop = (id: string) => { entries.current = entries.current.filter(entry => entry.id !== id); setRows(current => current.filter(row => row.id !== id)); };

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let id = waiting.current.shift(); id; id = waiting.current.shift()) {
        const entry = entries.current.find(item => item.id === id);
        if (!entry || entry.controller.signal.aborted) continue;
        const { file, folderId, controller } = entry, call = actions.current;
        try {
          update(id, { kind: 'reading' });
          const metadata = await inspectMedia(file);
          controller.signal.throwIfAborted();
          const kind = metadata.kind;
          if (kind === 'model') throw new Error('Choose video, audio or image files.');
          const details = { ...metadata, kind, fileName: file.name, contentType: file.type, size: file.size };
          // Choosing a file whose upload was interrupted continues it.
          await uploadResumable<Id<'cloudMedia'>, null>(file, {
            scope: 'library',
            start: () => startDirect(options => folderId ? call.startInFolder({ ...details, folderId, ...options }) : call.start({ ...details, ...options })),
            resume: (uploadId, parts) => call.resume({ uploadId, size: file.size, parts }).catch(reason => { if (!backendLacks(reason)) throw reason; return undefined; }),
            // Each request for links marks the upload active; small batches keep that mark current on slow lines.
            partUrls: (uploadId, from, count) => call.partUrls({ uploadId, from, count: Math.min(count, 8) }).catch(async reason => { if (!backendLacks(reason)) throw reason; return [{ partNumber: from, url: await call.partUrl({ uploadId, partNumber: from }), ttlMs: 3600_000 }]; }),
            complete: (uploadId, parts) => call.complete({ uploadId, parts }),
            abort: uploadId => call.abort({ uploadId }),
          }, (percent, activity) => update(id, { kind: 'uploading', percent, activity }), controller.signal, () => update(id, { kind: 'saving' }));
          drop(id);
        } catch (reason) {
          if (controller.signal.aborted) drop(id);
          else update(id, { kind: 'failed', message: userError(reason, 'Could not upload this file. Try again.') });
        }
      }
    } finally { running.current = false; }
  }, []);

  const enqueue = useCallback((files: File[], folderId?: Id<'storageFolders'>) => {
    if (!files.length) return;
    setError('');
    if (files.length + entries.current.length > MAX_FILES) { setError(`Upload up to ${MAX_FILES} files at a time.`); return; }
    const added = files.map(file => ({ id: crypto.randomUUID(), file, folderId, controller: new AbortController() }));
    entries.current.push(...added); waiting.current.push(...added.map(entry => entry.id));
    setRows(current => [...current, ...added.map(entry => ({ id: entry.id, name: entry.file.name, size: entry.file.size, state: { kind: 'waiting' } as UploadState }))]);
    void run();
  }, [run]);
  /** Stops a running upload, or removes a waiting or failed one. */
  const cancel = useCallback((id: string) => {
    const entry = entries.current.find(item => item.id === id);
    if (!entry) return;
    entry.controller.abort();
    const row = waiting.current.includes(id);
    waiting.current = waiting.current.filter(item => item !== id);
    setRows(current => { const state = current.find(item => item.id === id)?.state.kind; if (row || state === 'failed' || state === 'waiting') { entries.current = entries.current.filter(item => item.id !== id); return current.filter(item => item.id !== id); } return current; });
  }, []);
  const retry = useCallback((id: string) => {
    const entry = entries.current.find(item => item.id === id);
    if (!entry) return;
    entry.controller = new AbortController(); waiting.current.push(id); update(id, { kind: 'waiting' });
    void run();
  }, [run]);
  return { rows, error, clearError: () => setError(''), enqueue, cancel, retry };
}
