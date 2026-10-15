'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Pause, Play, Plus, Upload } from 'lucide-react';
import type { MediaAsset } from '@/lib/editor/types';
import { STOCK_AUDIO_CATALOG, isStockAudioAsset, stockAudioAsset } from '@/lib/editor/stock-audio';
import { STOCK_AUDIO_DRAG_TYPE } from '@/lib/editor/stock-audio-drag';
import './sfx-library.css';

const categories = ['All sounds', 'Whooshes', 'Risers', 'Clicks', 'Pops & tones', 'Transitions', 'Hits', 'Your audio'];
export function SfxLibrary({ assets, query, onAdd, onAddStockAudio, onUpload, uploading }: {
  assets: readonly MediaAsset[]; query: string; onAdd?: (asset: MediaAsset) => void;
  onAddStockAudio?: (catalogId: string) => Promise<void>; onUpload?: () => void; uploading: boolean;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null), [category, setCategory] = useState('All sounds');
  const [error, setError] = useState(''), [adding, setAdding] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const sounds = [
    ...STOCK_AUDIO_CATALOG.map(sound => ({ asset: stockAudioAsset(sound.id), name: sound.name, category: sound.category, tags: sound.tags.join(' '), catalogId: sound.id })),
    ...assets.filter(asset => asset.kind === 'audio' && !isStockAudioAsset(asset)).map(asset => ({ asset, name: asset.fileName, category: 'Your audio', tags: '', catalogId: undefined })),
  ];
  const search = query.trim().toLowerCase();
  const visible = sounds.filter(sound => (category === 'All sounds' || category === sound.category) && `${sound.name} ${sound.tags} ${sound.category}`.toLowerCase().includes(search));
  const preview = sounds.find(sound => sound.asset._id === previewId)?.asset;
  useEffect(() => {
    const player = audio.current;
    if (!player || !preview?.url) return;
    let active = true;
    player.volume = .5;
    void player.play().catch(() => { if (active) { setError('Could not preview this sound. Try again.'); setPreviewId(null); } });
    return () => { active = false; player.pause(); };
  }, [preview?._id, preview?.url]);
  async function add(catalogId: string) {
    setError('');setAdding(catalogId);
    try { await onAddStockAudio?.(catalogId); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not add this sound. Try again.'); }
    finally { setAdding(null); }
  }
  return <section className="library-sfx" aria-label="Audio FX">
    <div className="library-sfx-categories" role="group" aria-label="Audio FX categories">{categories.map(value => <button key={value} type="button" aria-pressed={category === value} onClick={() => { setCategory(value);setPreviewId(null); }}>{value}</button>)}</div>
    {onUpload && <button type="button" className="library-look library-sfx-upload" disabled={uploading} onClick={onUpload}><Upload size={14}/><span>{uploading ? 'Uploading…' : 'Upload sounds'}</span></button>}
    {!visible.length ? <p className="library-empty">{category === 'Your audio' && !search ? 'Upload a sound to see it here.' : 'No matching sounds.'}</p> : <div className="library-look-grid">{visible.map(({ asset, name, category, catalogId }) => {
      const available = catalogId ? !!onAddStockAudio && !adding : !!onAdd;
      return <div key={asset._id} className="library-sfx-row" data-catalog-id={catalogId}>
        <button type="button" className="library-sfx-preview" disabled={!asset.url} aria-label={`${previewId === asset._id ? 'Stop' : 'Preview'} ${name}`} aria-pressed={previewId === asset._id} onClick={() => { setError('');setPreviewId(previous => previous === asset._id ? null : asset._id); }}>{previewId === asset._id ? <Pause size={14}/> : <Play size={14}/>}</button>
        <span className="library-sfx-details"><strong title={name}>{name}</strong><small>{!asset.url ? 'Unavailable · re-import sound' : `${category} · ${asset.duration === undefined ? 'Audio' : `${asset.duration.toFixed(2)} s`}`}</small></span>
        <button type="button" className="library-sfx-add" disabled={!asset.url || !available} draggable={!!asset.url && available} aria-label={`Add ${name} at playhead`} title="Click to add at playhead, or drag onto an audio track" onClick={() => { if (catalogId) void add(catalogId); else onAdd?.(asset); }} onDragStart={event => {
          if (!asset.url || !available) { event.preventDefault();return; }
          event.dataTransfer.effectAllowed = 'copy';event.dataTransfer.setData(catalogId ? STOCK_AUDIO_DRAG_TYPE : 'revline/asset', catalogId ?? asset._id);
        }}>{adding === catalogId ? <LoaderCircle size={14} className="animate-spin"/> : <Plus size={14}/>}</button>
      </div>;
    })}</div>}
    {error && <p className="library-selection-note" role="alert">{error}</p>}
    {preview?.url && <audio key={preview._id} ref={audio} src={preview.url} preload="none" onEnded={() => setPreviewId(null)}/>}
    <a className="library-sfx-credits" href="https://kenney.nl/support" target="_blank" rel="noreferrer" title="CC0 sounds: Kenney Interface / Impact packs and Revline originals. Source licenses included with the application.">Sound credits ↗</a>
  </section>;
}
