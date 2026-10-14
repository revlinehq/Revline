'use client';

import { useEffect, useRef, useState } from 'react';
import { AudioLines, Pause, Play, Plus, Upload } from 'lucide-react';
import type { MediaAsset } from '@/lib/editor/types';
import './sfx-library.css';

export function SfxLibrary({ assets, query, onAdd, onUpload, uploading }: {
  assets: readonly MediaAsset[];
  query: string;
  onAdd?: (asset: MediaAsset) => void;
  onUpload?: () => void;
  uploading: boolean;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const sounds = assets.filter(asset => asset.kind === 'audio');
  const visible = sounds.filter(asset => asset.fileName.toLowerCase().includes(query.trim().toLowerCase()));
  const preview = sounds.find(asset => asset._id === previewId);

  useEffect(() => {
    const player = audio.current;
    if (!player || !preview?.url) return;
    let active = true;
    player.volume = 0.5;
    void player.play().catch(() => {
      if (active) { setError('Could not preview this sound. Try again or re-import it.'); setPreviewId(null); }
    });
    return () => { active = false; player.pause(); };
  }, [preview?._id, preview?.url]);

  return <section className="library-sfx" aria-label="Sound effects">
    <h3>Sound effects</h3>
    <p className="library-selection-note">Preview your uploaded audio, then add a sound at the playhead.</p>
    {onUpload && <button type="button" className="library-look library-sfx-upload" disabled={uploading} onClick={onUpload}><Upload size={14}/><span>{uploading ? 'Uploading…' : 'Upload sounds'}</span></button>}
    {!sounds.length ? <p className="library-empty">Upload a sound effect to get started.</p> : !visible.length ? <p className="library-empty">No matching sounds.</p> : <div className="library-look-grid">{visible.map(asset => <div key={asset._id} className="library-sfx-row">
      <button type="button" className="library-sfx-preview" disabled={!asset.url} aria-label={`${previewId === asset._id ? 'Stop' : 'Preview'} ${asset.fileName}`} aria-pressed={previewId === asset._id} onClick={() => { setError(''); setPreviewId(previous => previous === asset._id ? null : asset._id); }}>{previewId === asset._id ? <Pause size={14}/> : <Play size={14}/>}</button>
      <span className="library-sfx-details"><strong title={asset.fileName}>{asset.fileName}</strong><small>{!asset.url ? 'Unavailable · re-import sound' : asset.duration === undefined ? 'Audio' : `${asset.duration.toFixed(1)} s`}</small></span>
      <button type="button" className="library-sfx-add" disabled={!asset.url || !onAdd} draggable={!!asset.url && !!onAdd} aria-label={`Add ${asset.fileName} at playhead`} title="Click to add at playhead, or drag onto the timeline" onClick={() => onAdd?.(asset)} onDragStart={event => { if (!asset.url || !onAdd) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = 'copy'; event.dataTransfer.setData('revline/asset', asset._id); }}><Plus size={14}/></button>
    </div>)}</div>}
    {error && <p className="library-selection-note" role="alert">{error}</p>}
    {preview?.url && <audio key={preview._id} ref={audio} src={preview.url} preload="none" onEnded={() => setPreviewId(null)}/>}
    <small className="library-sfx-note"><AudioLines size={12}/>Uploaded sounds · development</small>
  </section>;
}
