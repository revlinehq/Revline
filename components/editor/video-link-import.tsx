'use client';
import { userError } from '@/lib/user-error';
import { useEffect, useId, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { Link2, LoaderCircle, Upload, X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProcessingStatus } from './processing-status';
import { parseVideoLink } from '@/lib/editor/video-link';
import { readStoredPreference, writeStoredPreference } from '@/lib/stored-preference';
import { MAX_MEDIA_TASK_ATTEMPTS } from '@/lib/media-analysis/errors';
import './video-link-import.css';
import { transferProgress } from '@/lib/editor/footage-progress';
import { useFootageProgress } from '@/lib/editor/footage-progress-store';

export type VideoImportState = { _id: string; status: string; progress: number; overallProgress?: number; progressKey?: string; attempt: number; error?: string };

export function VideoLinkImport({ onImport, onUpload, disabled = false }: { onImport: (url: string) => Promise<void>; onUpload?: () => void; disabled?: boolean }) {
  const id = useId();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  return <form className="video-link-import" onSubmit={async event => {
    event.preventDefault();
    if (disabled || submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await onImport(parseVideoLink(url).url); setUrl(''); }
    catch (error) { setError(userError(error, 'Could not import this video.')); }
    finally { submitting.current = false; setBusy(false); }
  }}>
    <label htmlFor={id}><Link2 size={13}/>Import a video link</label>
    <div className="video-link-field"><Input id={id} type="url" required maxLength={2048} placeholder="YouTube or MP4 URL" autoComplete="off" value={url} disabled={disabled || busy} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={!!error} onChange={event => { setUrl(event.target.value); setError(''); }}/><Button type="submit" variant="outline" disabled={disabled || busy || !url.trim()}>{busy ? <LoaderCircle size={14} className="animate-spin" aria-label="Starting import"/> : 'Import'}</Button></div>
    <small id={`${id}-hint`}>Long recordings and podcasts are supported. If a link cannot be downloaded, upload the file instead.</small>
    {error && <p id={`${id}-error`} className="video-link-error" role="alert">{error}</p>}
    {onUpload && <Button type="button" variant="ghost" size="sm" className="video-link-upload" disabled={disabled || busy} onClick={onUpload}><Upload size={14}/>Upload the file instead</Button>}
  </form>;
}

function importErrorMessage(error?: string) {
  const message = error?.replace(/^.*?(?:Uncaught ConvexError:|Server Error)\s*/s, '').split(/\n\s+at /)[0].trim();
  if (!message) return 'The video could not be downloaded. Try uploading the file instead.';
  if (message.includes('Your timeline is full. The imported video is saved in Sources.')) return 'Your video is saved in Sources. Use + beside it to add it to your timeline.';
  if (/no such option|Install yt-dlp|ENOENT/i.test(message)) return 'The video downloader is unavailable. Upload the file instead.';
  if (/ENOTFOUND|getaddrinfo/i.test(message)) return 'The video server could not be found. Check the link or upload the file instead.';
  if (/timed? out|ETIMEDOUT/i.test(message)) return 'The video server took too long to respond.';
  if (/ECONN|socket hang up|fetch failed/i.test(message)) return 'The connection to the video server was interrupted.';
  if (/^YouTube download failed:/i.test(message)) return 'YouTube could not finish the download. You can upload the file instead.';
  return message;
}

export function VideoImportProgress({ task, onUpload, progressKey }: { task: VideoImportState; onUpload: () => void; progressKey?: string }) {
  const progress = useFootageProgress(progressKey ?? task.progressKey ?? `task:${task._id}`, task.overallProgress ?? transferProgress(task.progress));
  const cancelImport = useMutation(api.mediaTasks.cancel);
  const failed = task.status === 'failed';
  const preparing = task.status === 'preparing';
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const submitting = useRef(false);
  const storageKey = `revline:import-notice:${task._id}`;
  useEffect(() => {
    setDismissed(failed && readStoredPreference(storageKey) === 'dismissed');
  }, [storageKey, failed]);
  if (task.status === 'completed' || task.status === 'cancelled' || failed && dismissed) return null;
  const attempt = Math.max(1, task.attempt);
  const retrying = task.status === 'retrying' || attempt > 1;
  const message = importErrorMessage(task.error);
  const attemptDetail = task.status === 'retrying'
    ? `Retrying with attempt ${attempt + 1} of ${MAX_MEDIA_TASK_ATTEMPTS}.`
    : `Attempt ${attempt} of ${MAX_MEDIA_TASK_ATTEMPTS}.`;
  const detail = failed
    ? `${message} Import stopped after ${attempt} ${attempt === 1 ? 'attempt' : 'attempts'}.`
    : preparing ? 'Your video has downloaded. Preparing it for editing.'
    : `${task.error ? `${message} ` : 'Downloading and preparing your footage. '}${attemptDetail}`;
  async function recover(upload: boolean) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setActionError('');
    try {
      await cancelImport({ taskId: task._id as Id<'mediaTasks'> });
      if (upload) onUpload();
      else {
        setDismissed(true);
        writeStoredPreference(storageKey, 'dismissed');
      }
    } catch (error) { setActionError(userError(error, 'Could not stop this import. Please try again.')); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <div className="video-import-progress">
    <ProcessingStatus state={failed ? 'error' : 'working'} label={failed ? 'Video import failed' : preparing ? 'Preparing your footage…' : retrying ? 'Retrying video import…' : task.status === 'queued' ? 'Video import queued…' : 'Importing your video…'} detail={detail} progress={progress}/>
    {!preparing && <div className="video-import-actions">
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void recover(true)}><Upload size={14}/>Upload the file instead</Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void recover(false)}>{busy ? <LoaderCircle size={14} className="animate-spin"/> : <X size={14}/>}Cancel import</Button>
    </div>}
    {actionError && <p className="video-link-error" role="alert">{actionError}</p>}
  </div>;
}
