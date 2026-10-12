'use client';

import { useState } from 'react';
import { SlidersHorizontal, Layers, Crop, X, FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberControl } from './visual-controls';
import { FootagePanel, type UploadProgress } from './footage-panel';
import { type Clip, type MediaAsset } from '@/lib/editor/types';

export function PreviewInspector({ clip, audioClip, asset, assets, upload, onUpload, onAdd, onChange, onCrop, cropping=false, onClose }: { clip?: Clip; audioClip?: Clip; asset?: MediaAsset; assets: MediaAsset[]; upload: UploadProgress; onUpload: () => void; onAdd: (asset: MediaAsset) => void; onChange: (patch: Partial<Clip>) => void; onCrop: () => void; cropping?:boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'edit' | 'sources' | 'effects'>('edit');
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  return <aside className="preview-inspector" aria-label="Clip settings">
    <div className="inspector-tabs" role="tablist" aria-label="Editing tools" onKeyDown={event => {
      if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
      const tabs = ['sources','edit','effects'] as const;
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return;
      event.preventDefault(); setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`#inspector-${next}-tab`)?.focus();
    }}>
      <button role="tab" id="inspector-sources-tab" aria-controls="inspector-sources" aria-selected={tab === 'sources'} tabIndex={tab === 'sources' ? 0 : -1} onClick={() => setTab('sources')}><FolderOpen size={14}/>Sources</button>
      <button role="tab" id="inspector-edit-tab" aria-controls="inspector-edit" aria-selected={tab === 'edit'} tabIndex={tab === 'edit' ? 0 : -1} onClick={() => setTab('edit')}><SlidersHorizontal size={14}/>Edit</button>
      <button role="tab" id="inspector-effects-tab" aria-controls="inspector-effects" aria-selected={tab === 'effects'} tabIndex={tab === 'effects' ? 0 : -1} onClick={() => setTab('effects')}><Layers size={14}/>Effects</button>
      <button className="inspector-close" aria-label="Close editing panel" onClick={onClose}><X size={14}/></button>
    </div>
    <div className="inspector-content" role="tabpanel" id={`inspector-${tab}`} aria-labelledby={`inspector-${tab}-tab`}>
      {tab === 'sources' ? <FootagePanel variant="inspector" assets={assets} upload={upload} onUpload={onUpload} onAdd={onAdd}/> : tab === 'edit' ? clip ? <>
        <div className="inspector-selection"><small>{text ? 'Text' : clip.kind === 'audio' ? 'Audio' : 'Footage'}</small><p>{clip.text || asset?.fileName || 'Selected clip'}</p></div>
        {text && <><label className="inspector-field">Words<textarea aria-label="Selected text" value={clip.text ?? ''} maxLength={500} onChange={e => onChange({ text: e.target.value })}/></label><div className="inspector-field-row"><NumberControl label="Text size" min={8} max={300} value={clip.fontSize ?? (clip.kind === 'graphic' ? 92 : 52)} onCommit={fontSize => onChange({ fontSize })}/><label className="inspector-field">Color<input aria-label="Text color" type="color" value={clip.color ?? '#ffffff'} onChange={e => onChange({ color: e.target.value })}/></label></div></>}
        {visual && <><div className="inspector-fit"><Button variant="outline" disabled={cropping} aria-pressed={clip.fit !== 'contain'} onClick={() => onChange({ fit: 'cover' })}>Fill</Button><Button variant="outline" disabled={cropping} aria-pressed={clip.fit === 'contain'} onClick={() => onChange({ fit: 'contain' })}>Fit</Button></div><Button variant="outline" className="inspector-transform" aria-pressed={cropping} disabled={!asset?.width || !asset?.height || !asset.url} onClick={onCrop}><Crop size={14}/>{cropping?'Done cropping':'Crop'}</Button><p className="visual-control-note">{cropping?'Drag the edges in the preview. Escape cancels.':'Move and resize using the handles in the preview.'}</p></>}
        {(clip.kind === 'audio' || (clip.kind === 'video' && (!clip.audioSeparated || audioClip))) && <NumberControl label="Clip volume" min={0} max={100} value={Math.round(((audioClip ?? clip).volume ?? 1) * 100)} unit="%" onCommit={volume => onChange({ volume: volume / 100 })}/>}
      </> : <div className="inspector-empty"><SlidersHorizontal size={22} strokeWidth={1.2}/><p>Select a clip</p><span>Its editing controls appear here.</span></div> : text ? <><div className="inspector-selection"><small>Text motion</small><p>Keep it still, or bring it into frame.</p></div><div className="inspector-effect-options">{(['none', 'fade', 'rise'] as const).map(animation => <Button key={animation} variant="outline" aria-pressed={(clip?.animation ?? 'none') === animation} onClick={() => onChange({ animation })}>{animation === 'none' ? 'None' : animation === 'fade' ? 'Fade in' : 'Rise in'}</Button>)}</div></> : <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>Room for effects</p><span>Text motion is available when you select a text clip. More effects can live here.</span></div>}
    </div>
  </aside>;
}
