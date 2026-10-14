'use client';

import { SolidColorControls } from './solid-color-controls';
import { TextEffectsControls } from './text-effects-controls';
import { AppliedVisualEffects, CinematicBarsControls, PlaybackSpeedControls, VisualEffectsControls } from './visual-effects-controls';
import { FootageSelection, FootageSettings } from './footage-settings';
import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Layers, ArrowLeft } from 'lucide-react';
import { NumberControl } from './visual-controls';
import { FootagePanel, type UploadProgress } from './footage-panel';
import type { VideoImportState } from './video-link-import';
import { type Clip, type MediaAsset } from '@/lib/editor/types';
import { effectClipLabel, type EffectPreset } from '@/lib/editor/clip-effects';
import { EffectLibrary, type LibraryVisualEffect } from './effect-library';
import { DEFAULT_COLOR_GRADE, DEFAULT_DITHER, DEFAULT_GLITCH, DEFAULT_INVERT, DEFAULT_ZOOM_BLUR } from '@/lib/editor/visual-effects';
import { textTemplatePatch } from '@/lib/editor/text-effects';
import type { RemotionTextPreset } from '@/lib/editor/remotion-text';
import { SegmentedTabs } from './segmented-tabs';
import './preview-inspector.css';
import { subtitleStylePatch, type SubtitleStyleId } from '@/lib/editor/subtitle-styles';

const sections = [{ value: 'tools', label: 'Tools', id: 'inspector-tools-tab', panelId: 'inspector-tools' }, { value: 'media', label: 'My media', id: 'inspector-media-tab', panelId: 'inspector-media' }] as const;

export function PreviewInspector({ clip, audioClip, asset, assets, onRemoveAsset, usedAssetIds, upload, onUpload, onAdd, onChange, onPreviewEffects, onPlaybackRateChange, onAddEffect, onCrop, cropping=false, videoImports, onAddTextTemplate, onAddSubtitleStyle, onAddOverlay, onFadeThroughBlack, sourceRequest = 0, editRequest = 0 }: { onRemoveAsset?: (asset:MediaAsset)=>Promise<void>; usedAssetIds?:readonly string[]; sourceRequest?: number; editRequest?: number; onAddTextTemplate?: (preset: RemotionTextPreset) => void; onAddSubtitleStyle?: (style: SubtitleStyleId) => void; onAddOverlay?: (asset: MediaAsset) => void; onFadeThroughBlack?: () => void; clip?: Clip; audioClip?: Clip; asset?: MediaAsset; assets: MediaAsset[]; upload: UploadProgress; onUpload: () => void; onAdd: (asset: MediaAsset) => void; onChange: (patch: Partial<Clip>) => void; onPreviewEffects?: (patch: Partial<Clip> | null) => void; onPlaybackRateChange?: (rate: number) => void; onAddEffect?: (preset: EffectPreset) => void; onCrop: () => void; cropping?:boolean; videoImports?:VideoImportState[] }) {
  const [section, setSection] = useState<'tools' | 'media'>('tools');
  const [tab, setTab] = useState<'edit' | 'sources' | 'effects'>('sources');
  const [effectSelection, setEffectSelection] = useState<{clipId:string;key:LibraryVisualEffect} | null>(null);
  const onlyEffect = effectSelection && effectSelection.clipId === clip?.id && clip?.[effectSelection.key] ? effectSelection.key : undefined;
  const panel = useRef<HTMLElement>(null);
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  useEffect(() => setEffectSelection(null), [clip?.id]);
  useEffect(() => {
    if (!sourceRequest && !editRequest) return;
    if (sourceRequest > editRequest) setSection('media');
    else { setSection('tools'); setTab('edit'); setEffectSelection(null); }
  }, [sourceRequest, editRequest]);
  const zoomBlurControls = clip?.kind === 'effect' && clip.effectPreset === 'zoom-blur' ? <VisualEffectsControls key={clip.id} clip={clip} onlyEffect="zoomBlur" onChange={onChange} onPreview={onPreviewEffects}/> : null;
  const barControls = clip?.kind === 'effect' && clip.effectPreset === 'cinematic-bars' ? <CinematicBarsControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/> : null;
  const solidControls = clip?.kind === 'effect' && clip.effectPreset === 'solid-color' ? <SolidColorControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/> : null;
  function addTimedEffect(preset: EffectPreset) {
    onAddEffect?.(preset);
    if (preset === 'solid-color') { setEffectSelection(null); setTab('effects'); }
  }
  function addVisualEffect(effect: LibraryVisualEffect) {
    if (!visual || !clip) return;
    const defaults = { colorGrade: DEFAULT_COLOR_GRADE, glitch: DEFAULT_GLITCH, dither: DEFAULT_DITHER, invert: DEFAULT_INVERT, zoomBlur: DEFAULT_ZOOM_BLUR };
    onChange({ [effect]: { ...defaults[effect], ...clip[effect], enabled: true } });
    setEffectSelection({clipId:clip.id,key:effect});
    setTab('effects');
  }
  function applyTextTemplate(preset: RemotionTextPreset) {
    if (text && clip) onChange(textTemplatePatch(clip, preset));
    else onAddTextTemplate?.(preset);
    setTab('effects');
  }
  function applySubtitleStyle(style: SubtitleStyleId) {
    if (clip?.kind === 'caption') onChange(subtitleStylePatch(style));
    else onAddSubtitleStyle?.(style);
    setTab('edit');
  }
  const effect = clip?.kind === 'effect';
  const activeTab = text && tab === 'effects' ? 'edit' : (visual || effect) && tab === 'edit' ? 'effects' : tab;
  const library = activeTab === 'sources';
  return <aside ref={panel} className="preview-inspector" aria-label="Clip settings">
    <SegmentedTabs className="inspector-section-tabs" label="Tools and media" options={sections} value={section} onChange={setSection}/>
    {section === 'media' ? <div className="inspector-content inspector-media-content" id="inspector-media" role="tabpanel" aria-labelledby="inspector-media-tab"><FootagePanel onRemove={onRemoveAsset} usedAssetIds={usedAssetIds} key={sourceRequest} variant="library" videoImports={videoImports} assets={assets} upload={upload} onUpload={onUpload} onAdd={onAdd}/></div> : <div className="inspector-tools" id="inspector-tools" role="tabpanel" aria-labelledby="inspector-tools-tab">
    {library ? clip && <div className="inspector-library-heading"><span>{asset?.fileName || clip.text || 'Selected clip'}</span><button type="button" onClick={() => { setEffectSelection(null); setTab(visual || effect ? 'effects' : 'edit'); }}><SlidersHorizontal size={12}/>{visual || effect ? 'Clip settings' : 'Edit selected clip'}</button></div> : <div className="inspector-tabs" role="tablist" aria-label="Editing tools" onKeyDown={event => {
      if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
      const tabs: readonly ('sources' | 'edit' | 'effects')[] = text ? ['sources','edit'] : visual || effect ? ['sources','effects'] : ['sources','edit','effects'];
      const index = tabs.indexOf(activeTab);
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return;
      event.preventDefault(); setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`#inspector-${next}-tab`)?.focus();
      if (next === 'sources') requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('.library-tabs [aria-selected="true"]')?.focus());
    }}>
      <button role="tab" id="inspector-sources-tab" aria-controls="inspector-sources" aria-selected={false} tabIndex={-1} onClick={() => setTab('sources')}><ArrowLeft size={12}/>Library</button>
      {!visual && !effect && <button role="tab" id="inspector-edit-tab" aria-controls="inspector-edit" aria-selected={activeTab === 'edit'} tabIndex={activeTab === 'edit' ? 0 : -1} onClick={() => setTab('edit')}><SlidersHorizontal size={14}/>Edit</button>}
      {!text && <button role="tab" id="inspector-effects-tab" aria-controls="inspector-effects" aria-selected={activeTab === 'effects'} tabIndex={activeTab === 'effects' ? 0 : -1} onClick={() => { if (visual) setEffectSelection(null); setTab('effects'); }}>{visual ? <SlidersHorizontal size={14}/> : <Layers size={14}/>}{visual ? 'Clip settings' : 'Effects'}</button>}
    </div>}
    {library ? <div className="inspector-content inspector-library-content" id="inspector-sources"><EffectLibrary clip={clip} assets={assets} onVisualEffect={addVisualEffect} onAddEffect={onAddEffect ? addTimedEffect : undefined} onTextTemplate={text || onAddTextTemplate ? applyTextTemplate : undefined} onSubtitleStyle={clip?.kind === 'caption' || onAddSubtitleStyle ? applySubtitleStyle : undefined} onAddOverlay={onAddOverlay} onFadeThroughBlack={onFadeThroughBlack} onSpeed={onPlaybackRateChange ? () => { setEffectSelection(null); setTab('effects'); } : undefined}/></div> : <div className="inspector-content" role="tabpanel" id={`inspector-${activeTab}`} aria-labelledby={`inspector-${activeTab}-tab`}>
      {activeTab === 'edit' ? clip?.kind === 'effect' ? solidControls ?? barControls ?? <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>{effectClipLabel(clip)}</p><span>Move, trim, or delete this clip on the timeline.</span></div> : clip ? <>
        <div className="inspector-selection"><small>{text ? 'Text' : clip.kind === 'audio' ? 'Audio' : 'Footage'}</small><p>{clip.text || asset?.fileName || 'Selected clip'}</p></div>
        {text && <TextEffectsControls clip={clip} onChange={onChange}/>}

        {clip.kind === 'audio' && <NumberControl label="Clip volume" min={0} max={200} value={Math.round(((audioClip ?? clip).volume ?? 1) * 100)} unit="%" onCommit={volume => onChange({ volume: volume / 100 })}/>}
      </> : <div className="inspector-empty"><SlidersHorizontal size={22} strokeWidth={1.2}/><p>Select a clip</p><span>Its editing controls appear here.</span></div> : visual && clip ? onlyEffect ? <div className="inspector-effect-detail">
        <button type="button" className="inspector-effect-back" aria-label="Back to clip settings" onClick={() => setEffectSelection(null)}><ArrowLeft size={12}/>Clip settings</button>
        <FootageSelection clip={clip} asset={asset}/>
        <VisualEffectsControls key={`${clip.id}-${onlyEffect}`} onlyEffect={onlyEffect} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/>
      </div> : <div className="inspector-clip-settings">
        <FootageSettings key={clip.id} clip={clip} audioClip={audioClip} asset={asset} onChange={onChange} onPlaybackRateChange={onPlaybackRateChange} onCrop={onCrop} cropping={cropping}/>
        <AppliedVisualEffects clip={clip} onSelect={key => setEffectSelection({ clipId: clip.id, key })} onAdd={() => setTab('sources')}/>
      </div> : solidControls ? solidControls : zoomBlurControls ? zoomBlurControls : barControls ? barControls : clip?.kind === 'audio' && onPlaybackRateChange ? <PlaybackSpeedControls clip={clip} onChange={onPlaybackRateChange}/> : effect && clip ? <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>{effectClipLabel(clip)}</p><span>Move, trim, or delete this effect on the timeline.</span></div> : <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>Select a visual clip</p><span>Choose footage for effects or a text clip to animate it.</span></div>}
    </div>}
    </div>}
  </aside>;
}
