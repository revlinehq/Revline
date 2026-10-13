'use client';

import { TextEffectsControls } from './text-effects-controls';
import { TextEditingControls } from './text-editing-controls';
import { CinematicBarsControls, PlaybackSpeedControls, TimedEffectPresets, VisualEffectsControls } from './visual-effects-controls';
import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Layers, Crop, X, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NumberControl } from './visual-controls';
import { FootagePanel, type UploadProgress } from './footage-panel';
import type { VideoImportState } from './video-link-import';
import { type Clip, type MediaAsset } from '@/lib/editor/types';
import { BLEND_MODES, effectClipLabel, type EffectPreset } from '@/lib/editor/clip-effects';
import { EffectLibrary, type LibraryVisualEffect } from './effect-library';
import { DEFAULT_COLOR_GRADE, DEFAULT_GLITCH, DEFAULT_INVERT, DEFAULT_ZOOM_BLUR } from '@/lib/editor/visual-effects';
import { textTemplatePatch } from '@/lib/editor/text-effects';
import type { RemotionTextPreset } from '@/lib/editor/remotion-text';

export function PreviewInspector({ clip, audioClip, asset, assets, upload, onUpload, onAdd, onChange, onPreviewEffects, onPlaybackRateChange, onAddEffect, onCrop, cropping=false, onClose, videoImports, onAddTextTemplate, onAddOverlay, onFadeThroughBlack, sourceRequest = 0 }: { sourceRequest?: number; onAddTextTemplate?: (preset: RemotionTextPreset) => void; onAddOverlay?: (asset: MediaAsset) => void; onFadeThroughBlack?: () => void; clip?: Clip; audioClip?: Clip; asset?: MediaAsset; assets: MediaAsset[]; upload: UploadProgress; onUpload: () => void; onAdd: (asset: MediaAsset) => void; onChange: (patch: Partial<Clip>) => void; onPreviewEffects?: (patch: Partial<Clip> | null) => void; onPlaybackRateChange?: (rate: number) => void; onAddEffect?: (preset: EffectPreset) => void; onCrop: () => void; cropping?:boolean; onClose: () => void; videoImports?:VideoImportState[] }) {
  const [tab, setTab] = useState<'edit' | 'sources' | 'effects'>('sources');
  const [mediaOpen, setMediaOpen] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  useEffect(() => {
    if (clip?.kind === 'effect' && clip.effectPreset === 'cinematic-bars') setTab(current => current === 'sources' ? 'effects' : current);
  }, [clip?.id, clip?.kind, clip?.effectPreset]);
  useEffect(() => {
    if (!sourceRequest) return;
    setTab('sources'); setMediaOpen(true);
  }, [sourceRequest]);
  const barControls = clip?.kind === 'effect' && clip.effectPreset === 'cinematic-bars' ? <CinematicBarsControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/> : null;
  function addVisualEffect(effect: LibraryVisualEffect) {
    if (!visual || !clip) return;
    const defaults = { colorGrade: DEFAULT_COLOR_GRADE, glitch: DEFAULT_GLITCH, invert: DEFAULT_INVERT, zoomBlur: DEFAULT_ZOOM_BLUR };
    onChange({ [effect]: { ...defaults[effect], ...clip[effect], enabled: true } });
    setTab('effects');
  }
  function applyTextTemplate(preset: RemotionTextPreset) {
    if (text && clip) onChange(textTemplatePatch(clip, preset));
    else onAddTextTemplate?.(preset);
    setTab('effects');
  }
  const library = tab === 'sources' && !mediaOpen;
  return <aside ref={panel} className="preview-inspector" aria-label="Clip settings">
    {library ? <div className="inspector-library-heading"><span id="inspector-library-title">Sources</span>{clip && <button type="button" onClick={() => setTab('edit')}><SlidersHorizontal size={12}/>Edit selected clip</button>}<button type="button" aria-label="Close editing panel" onClick={onClose}><X size={14}/></button></div> : <div className="inspector-tabs" role="tablist" aria-label="Editing tools" onKeyDown={event => {
      if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
      const tabs = ['sources','edit','effects'] as const;
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return;
      event.preventDefault(); setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`#inspector-${next}-tab`)?.focus();
      if (next === 'sources' && !mediaOpen) requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('.library-tabs [aria-selected="true"]')?.focus());
    }}>
      <button role="tab" id="inspector-sources-tab" aria-controls="inspector-sources" aria-selected={tab === 'sources'} tabIndex={tab === 'sources' ? 0 : -1} onClick={() => { setMediaOpen(false); setTab('sources'); }}><ArrowLeft size={12}/>Library</button>
      <button role="tab" id="inspector-edit-tab" aria-controls="inspector-edit" aria-selected={tab === 'edit'} tabIndex={tab === 'edit' ? 0 : -1} onClick={() => setTab('edit')}><SlidersHorizontal size={14}/>Edit</button>
      <button role="tab" id="inspector-effects-tab" aria-controls="inspector-effects" aria-selected={tab === 'effects'} tabIndex={tab === 'effects' ? 0 : -1} onClick={() => setTab('effects')}><Layers size={14}/>{text ? 'Text effects' : 'Effects'}</button>
      <button className="inspector-close" aria-label="Close editing panel" onClick={onClose}><X size={14}/></button>
    </div>}
    <div className={`inspector-content ${library ? 'inspector-library-content' : ''}`} role={library ? 'region' : 'tabpanel'} id={`inspector-${tab}`} aria-labelledby={library ? 'inspector-library-title' : `inspector-${tab}-tab`}>
      {library ? <EffectLibrary clip={clip} assets={assets} onMedia={() => setMediaOpen(true)} onVisualEffect={addVisualEffect} onAddEffect={onAddEffect ? preset => { onAddEffect(preset); setTab('effects'); } : undefined} onTextTemplate={text || onAddTextTemplate ? applyTextTemplate : undefined} onUploadOverlay={onUpload} onAddOverlay={onAddOverlay} onFadeThroughBlack={onFadeThroughBlack} onSpeed={onPlaybackRateChange ? () => setTab('effects') : undefined}/> : tab === 'sources' ? <FootagePanel key={sourceRequest} variant="inspector" videoImports={videoImports} assets={assets} upload={upload} onUpload={onUpload} onAdd={onAdd}/> : tab === 'edit' ? clip?.kind === 'effect' ? barControls ?? <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>{effectClipLabel(clip)}</p><span>Move, trim, or delete this clip on the timeline.</span></div> : clip ? <>
        <div className="inspector-selection"><small>{text ? 'Text' : clip.kind === 'audio' ? 'Audio' : 'Footage'}</small><p>{clip.text || asset?.fileName || 'Selected clip'}</p></div>
        {text && <TextEditingControls clip={clip} onChange={onChange}/>}
        {visual && <><label className="inspector-field">Blend mode<select className="inspector-blend-mode" aria-label="Blend mode" value={clip.blendMode ?? 'normal'} onChange={event => onChange({ blendMode: event.currentTarget.value as Clip['blendMode'] })}>{BLEND_MODES.map(mode => <option key={mode} value={mode}>{mode === 'plus-lighter' ? 'Add / lighten' : mode[0].toUpperCase() + mode.slice(1)}</option>)}</select></label><div className="inspector-fit"><Button variant="outline" disabled={cropping} aria-pressed={clip.fit !== 'contain'} onClick={() => onChange({ fit: 'cover' })}>Fill</Button><Button variant="outline" disabled={cropping} aria-pressed={clip.fit === 'contain'} onClick={() => onChange({ fit: 'contain' })}>Fit</Button></div><Button variant="outline" className="inspector-transform" aria-pressed={cropping} disabled={!asset?.width || !asset?.height || !asset.url} onClick={onCrop}><Crop size={14}/>{cropping?'Done cropping':'Crop'}</Button><p className="visual-control-note">{cropping?'Drag the edges in the preview. Escape cancels.':'Double-click the footage in the preview to move or resize it.'}</p></>}
        {(clip.kind === 'audio' || (clip.kind === 'video' && (!clip.audioSeparated || audioClip))) && <NumberControl label="Clip volume" min={0} max={200} value={Math.round(((audioClip ?? clip).volume ?? 1) * 100)} unit="%" onCommit={volume => onChange({ volume: volume / 100 })}/>}
      </> : <div className="inspector-empty"><SlidersHorizontal size={22} strokeWidth={1.2}/><p>Select a clip</p><span>Its editing controls appear here.</span></div> : text && clip ? <TextEffectsControls clip={clip} onChange={onChange}/> : visual && clip ? <VisualEffectsControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects} onPlaybackRateChange={onPlaybackRateChange} onAddEffect={onAddEffect}/> : barControls ? <>{barControls}{onAddEffect && <TimedEffectPresets onAdd={onAddEffect}/>}</> : clip?.kind === 'audio' && onPlaybackRateChange ? <PlaybackSpeedControls clip={clip} onChange={onPlaybackRateChange}/> : onAddEffect ? <TimedEffectPresets onAdd={onAddEffect}/> : <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>Select a visual clip</p><span>Choose footage for effects or a text clip to animate it.</span></div>}
    </div>
  </aside>;
}
