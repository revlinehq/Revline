'use client';
import { useId, useRef, useState } from 'react';
import { Link2, LoaderCircle } from 'lucide-react';
import { parseVideoLink } from '@/lib/editor/video-link';
import './video-link-import.css';

export type VideoImportState = { _id: string; status: string; progress: number; error?: string };

export function VideoLinkImport({ onImport, disabled = false }: { onImport: (url: string) => Promise<void>; disabled?: boolean }) {
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
    catch (error) { setError(error instanceof Error ? error.message : 'Could not import this video.'); }
    finally { submitting.current = false; setBusy(false); }
  }}>
    <label htmlFor={id}><Link2 size={13}/>Import a video link</label>
    <div className="video-link-field"><input id={id} type="url" required maxLength={2048} placeholder="YouTube or MP4 URL" autoComplete="off" value={url} disabled={disabled || busy} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={!!error} onChange={event => { setUrl(event.target.value); setError(''); }}/><button type="submit" disabled={disabled || busy || !url.trim()}>{busy ? <LoaderCircle size={14} className="animate-spin" aria-label="Starting import"/> : 'Import'}</button></div>
    <small id={`${id}-hint`}>Public videos · up to 5 min / 500 MB</small>
    {error && <p id={`${id}-error`} className="video-link-error" role="alert">{error}</p>}
  </form>;
}

export function VideoImportProgress({ task }: { task: VideoImportState }) {
  const failed = task.status === 'failed';
  return <div className="video-import-progress" role={failed ? 'alert' : 'status'}>
    <span>{!failed && <LoaderCircle size={14} className="animate-spin"/>}{failed ? 'Video import failed' : task.status === 'retrying' ? 'Retrying video import…' : task.status === 'queued' ? 'Video import queued…' : 'Importing your video…'}</span>
    {!failed && <progress aria-label="Video import progress" max={100} {...(task.progress ? { value: task.progress } : {})}/>}
    <small>{failed ? task.error || 'Try another public video link.' : 'Downloading, preparing, and adding to your timeline. You can leave this page.'}</small>
  </div>;
}
