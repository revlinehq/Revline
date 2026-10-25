'use client';

import { SceneControls } from './scene-controls';
import { SolidColorControls } from './solid-color-controls';
import {FrameShrinkControls, ZoomControls, MotionEffectControls} from './effect-clip-controls';
import {isPropertyEffectPreset} from '@/lib/editor/motion-effect-settings';
import { TextEffectsControls } from './text-effects-controls';
import { AudioControls } from './audio-controls';
import type { CaptionActions } from './caption-controls';
import { AppliedVisualEffects, CinematicBarsControls, PlaybackSpeedControls, VisualEffectsControls } from './visual-effects-controls';
import { FootageSettings } from './footage-settings';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, SlidersHorizontal, Layers, Film, PanelRightClose } from 'lucide-react';
import { FootagePanel, type UploadProgress } from './footage-panel';
import type { VideoImportState } from './video-link-import';
import { type Clip, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { effectClipLabel, isSolidColorClip, isZoomPreset, isZoomFamilyPreset, type EffectPreset } from '@/lib/editor/clip-effects';
import { EffectLibrary, type LibraryVisualEffect, type LibraryCategoryRequest, type LibraryShortcutCategory } from './effect-library';
import { visualEffectsPatch } from '@/lib/editor/visual-effects';
import { colorLookGrade, type ColorLookId } from '@/lib/editor/color-looks';
import { textLookPatch, type TextLookId } from '@/lib/editor/text-looks';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TransitionControls } from './transition-controls';
import { isTransitionPreset, type TransitionPreset } from '@/lib/editor/clip-transitions';
import './preview-inspector.css';
import { BackgroundRemovalControl } from './background-removal-control';
import type { Id } from '@/convex/_generated/dataModel';

const sections = [{ value: 'tools', label: 'Tools', id: 'inspector-tools-tab', panelId: 'inspector-tools', icon: <SlidersHorizontal size={14} strokeWidth={1.5}/> }, { value: 'media', label: 'My media', id: 'inspector-media-tab', panelId: 'inspector-media', icon: <Film size={14} strokeWidth={1.5}/> }] as const;

export function PreviewInspector({ backgroundRemoval, onClose, clip, timeline, time = 0, onSeek, audioClip, asset, assets, onRemoveAsset, usedAssetIds, upload, onUpload, onAdd, onChange, onPreviewEffects, onConvertSolidColor, onPlaybackRateChange, onAddEffect, onAddTransition, onCrop, cropping=false, readOnly=false, videoImports, onAddTextLook, captionActions, onAddOverlay, onFadeThroughBlack, onAddSound, onAddStockAudio, sourceRequest = 0, editRequest = 0, libraryRequest, onLibraryCategoryChange }: { backgroundRemoval?: { projectId: Id<'projects'> }; onClose?: () => void; libraryRequest?: LibraryCategoryRequest; onLibraryCategoryChange?: (category: LibraryShortcutCategory) => void; onAddStockAudio?: (catalogId:string)=>Promise<void>; onAddSound?: (asset:MediaAsset)=>void; onRemoveAsset?: (asset:MediaAsset)=>Promise<void>; usedAssetIds?:readonly string[]; sourceRequest?: number; editRequest?: number; onAddTextLook?: (look: TextLookId) => void; captionActions?: CaptionActions; onAddOverlay?: (asset: MediaAsset) => void; onFadeThroughBlack?: () => void; clip?: Clip; timeline?: Timeline; time?: number; onSeek?: (time:number)=>void; audioClip?: Clip; asset?: MediaAsset; assets: MediaAsset[]; upload: UploadProgress; onUpload: () => void; onAdd: (asset: MediaAsset) => void; onChange: (patch: Partial<Clip>) => void; onPreviewEffects?: (patch: Partial<Clip> | null) => void; onConvertSolidColor?:()=>void; onPlaybackRateChange?: (rate: number) => void; onAddEffect?: (preset: EffectPreset) => void; onAddTransition?: (preset: TransitionPreset) => void; onCrop: () => void; cropping?:boolean; readOnly?:boolean; videoImports?:VideoImportState[] }) {
  const [section, setSection] = useState<'tools' | 'media'>('tools');
  const [tab, setTab] = useState<'edit' | 'sources' | 'effects'>('sources');
  const [effectSelection, setEffectSelection] = useState<{clipId:string;key:LibraryVisualEffect;view:'page'|'inline'} | null>(null);
  const expandedEffect = effectSelection && effectSelection.clipId === clip?.id && clip?.[effectSelection.key] ? effectSelection.key : undefined;
  const removedEffect = !!effectSelection && effectSelection.clipId === clip?.id && !expandedEffect;
  const panel = useRef<HTMLElement>(null);
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  const scene = clip?.kind === 'scene';
  useEffect(() => {
    setEffectSelection(null);
    if (!clip) setTab('sources');
  }, [clip?.id]);
  useEffect(() => {
    if (!removedEffect) return;
    setEffectSelection(null);
  }, [removedEffect]);
  useEffect(() => {
    if (!sourceRequest && !editRequest && !libraryRequest) return;
    if (libraryRequest && libraryRequest.requestId > Math.max(sourceRequest, editRequest)) { setSection('tools'); setTab('sources'); setEffectSelection(null); }
    else if (sourceRequest > editRequest) setSection('media');
    else { setSection('tools'); setTab('edit'); setEffectSelection(null); }
  }, [sourceRequest, editRequest, libraryRequest]);
  const transitionControls = clip?.kind === 'effect' && isTransitionPreset(clip.effectPreset) && timeline ? <TransitionControls key={clip.id} clip={clip} timeline={timeline} assets={assets} onChange={onChange} onPreview={onPreviewEffects}/> : null;
  const zoomBlurControls = clip?.kind === 'effect' && clip.effectPreset === 'zoom-blur' ? <VisualEffectsControls key={clip.id} clip={clip} onlyEffect="zoomBlur" onChange={onChange} onPreview={onPreviewEffects}/> : null;
  const barControls = clip?.kind === 'effect' && clip.effectPreset === 'cinematic-bars' ? <CinematicBarsControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/> : null;
  const frameControls=clip?.kind==='effect'&&clip.effectPreset==='frame-shrink'?<FrameShrinkControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/>:null;
  const zoomControls = clip?.kind === 'effect' && isZoomFamilyPreset(clip.effectPreset) ? <ZoomControls key={clip.id} fps={timeline?.fps} clip={clip} onChange={onChange} onPreview={onPreviewEffects}/> : null;
  const motionControls=clip?.kind==='effect'&&isPropertyEffectPreset(clip.effectPreset)?<MotionEffectControls key={clip.id} clip={clip} fps={timeline?.fps} onChange={onChange} onPreview={onPreviewEffects}/>:null;
  const solidControls = clip && isSolidColorClip(clip) ? <SolidColorControls key={clip.id} clip={clip} onChange={onChange} onPreview={onPreviewEffects} onConvert={onConvertSolidColor}/> : null;
  function addTimedEffect(preset: EffectPreset) {
    onAddEffect?.(preset);
    if (preset === 'solid-color'||preset==='frame-shrink'||isZoomPreset(preset)||isPropertyEffectPreset(preset)) { setEffectSelection(null); setTab('effects'); }
  }
  function addTransition(preset: TransitionPreset) {
    onAddTransition?.(preset); setEffectSelection(null); setTab('effects');
  }
  function addVisualEffect(effect: LibraryVisualEffect) {
    if (!visual || !clip) return;
    onChange(visualEffectsPatch(clip, { [effect]: { enabled: true } }));
    setEffectSelection({clipId:clip.id,key:effect,view:'page'});
    setTab('effects');
  }
  function applyTextLook(look: TextLookId) {
    if (text && clip) onChange(textLookPatch(clip, look));
    else onAddTextLook?.(look);
    setTab('edit');
  }
  function applyColorLook(look: ColorLookId) {
    if (!visual || !clip) return;
    onChange({ colorGrade: colorLookGrade(look) });
    setEffectSelection({ clipId: clip.id, key: 'colorGrade', view: 'page' });
    setTab('effects');
  }
  const effect = clip?.kind === 'effect' || clip?.kind === 'solid';
  const activeTab = !clip ? 'sources' : (text || scene) && tab === 'effects' ? 'edit' : (visual || effect) && tab === 'edit' ? 'effects' : tab;
  const library = activeTab === 'sources';
  const effectPage = visual && expandedEffect && effectSelection?.view === 'page' ? expandedEffect : undefined;
  return <Tabs value={section} onValueChange={next => { setSection(next as 'tools' | 'media'); if (next === 'tools') { setTab('sources'); setEffectSelection(null); } }} asChild><aside ref={panel} className="preview-inspector" aria-label="Clip settings">
    <TabsList className="inspector-section-tabs" aria-label="Tools and media" onKeyDown={event => { if (event.key === 'Home') { setTab('sources'); setEffectSelection(null); } }}>{sections.map(item => <TabsTrigger key={item.value} id={item.id} aria-controls={item.panelId} value={item.value} onClick={() => { if (item.value === 'tools') { setTab('sources'); setEffectSelection(null); } }}>{item.icon}{item.label}</TabsTrigger>)}</TabsList>
    {onClose && <button type="button" className="inspector-close" aria-label="Hide editing panel" title="Hide editing panel" onClick={onClose}><PanelRightClose size={15} strokeWidth={1.5}/></button>}
    {section === 'media' ? <TabsContent value="media" className="inspector-content inspector-media-content" id="inspector-media" aria-labelledby="inspector-media-tab"><FootagePanel onRemove={onRemoveAsset} usedAssetIds={usedAssetIds} key={sourceRequest} variant="library" videoImports={videoImports} assets={assets} upload={upload} onUpload={onUpload} onAdd={onAdd}/></TabsContent> : <TabsContent value="tools" className="inspector-tools" id="inspector-tools" aria-labelledby="inspector-tools-tab">
    {library ? clip && <div className="inspector-library-heading"><span>{asset?.fileName || clip.scene?.title || clip.text || 'Selected clip'}</span><button type="button" onClick={() => { setEffectSelection(null); setTab(visual || effect ? 'effects' : 'edit'); }}><SlidersHorizontal size={12}/>{visual || effect ? 'Clip settings' : 'Edit selected clip'}</button></div> : !text && !visual && !effect && !scene && <div className="inspector-tabs" role="tablist" aria-label="Editing tools" onKeyDown={event => {
      if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
      const tabs: readonly ('edit' | 'effects')[] = text ? ['edit'] : ['edit','effects'];
      const index = tabs.indexOf(activeTab);
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : undefined;
      if (!next) return;
      event.preventDefault(); setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`#inspector-${next}-tab`)?.focus();
    }}>
      {!visual && !effect && <button role="tab" id="inspector-edit-tab" aria-controls="inspector-edit" aria-selected={activeTab === 'edit'} tabIndex={activeTab === 'edit' ? 0 : -1} onClick={() => setTab('edit')}><SlidersHorizontal size={14}/>Edit</button>}
      {!text && <button role="tab" id="inspector-effects-tab" aria-controls="inspector-effects" aria-selected={activeTab === 'effects'} tabIndex={activeTab === 'effects' ? 0 : -1} onClick={() => { if (visual) setEffectSelection(null); setTab('effects'); }}>{visual ? <SlidersHorizontal size={14}/> : <Layers size={14}/>}{visual ? 'Clip settings' : 'Effects'}</button>}
    </div>}
    {library ? <div className="inspector-content inspector-library-content" id="inspector-sources"><EffectLibrary cutoutLab={backgroundRemoval} categoryRequest={libraryRequest} onCategoryChange={onLibraryCategoryChange} clip={clip} timeline={timeline} time={time} onAddTransition={onAddTransition ? addTransition : undefined} assets={assets} onAddSound={onAddSound??onAdd} onAddStockAudio={onAddStockAudio} onUploadSound={onUpload} uploading={!!upload} onVisualEffect={addVisualEffect} onColorLook={applyColorLook} onAddEffect={onAddEffect ? addTimedEffect : undefined} onTextLook={text || onAddTextLook ? applyTextLook : undefined} onAddOverlay={onAddOverlay} onFadeThroughBlack={onFadeThroughBlack} onSpeed={onPlaybackRateChange ? () => { setEffectSelection(null); setTab('effects'); } : undefined}/></div> : <div key={effectPage ? `effect-${clip?.id}-${effectPage}` : 'clip-settings'} className={`inspector-content${text && activeTab === 'edit' ? ' inspector-text-content' : ''}`} role="tabpanel" id={`inspector-${activeTab}`} aria-label={effectPage ? 'Effect settings' : text ? 'Text settings' : visual || effect ? effect ? 'Effect settings' : 'Clip settings' : undefined} aria-labelledby={text || visual || effect ? undefined : `inspector-${activeTab}-tab`}>
      {activeTab === 'edit' ? clip && (clip.kind === 'effect' || clip.kind === 'solid') ? transitionControls ?? solidControls ?? barControls ?? frameControls ?? zoomControls ?? motionControls ?? <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>{effectClipLabel(clip)}</p><span>Move, trim, or delete this clip on the timeline.</span></div> : clip ? <>
        {!text && !scene && <div className="inspector-selection"><small>{text ? 'Text' : clip.kind === 'audio' ? 'Audio' : 'Footage'}</small><p>{clip.text || asset?.fileName || 'Selected clip'}</p></div>}
        {scene && <SceneControls key={clip.id} clip={clip} onChange={onChange} readOnly={readOnly}/>}
        {text && <TextEffectsControls clip={clip} onChange={onChange} onPreview={onPreviewEffects} captionActions={captionActions}/>}

        {clip.kind === 'audio' && <AudioControls key={clip.id} clip={clip} fps={timeline?.fps} onChange={onChange} onPreview={onPreviewEffects}/>}
      </> : <div className="inspector-empty"><SlidersHorizontal size={22} strokeWidth={1.2}/><p>Select a clip</p><span>Its editing controls appear here.</span></div> : visual && clip && effectPage ? <div className="inspector-effect-detail">
        <button type="button" className="inspector-effect-back" aria-label="Back to clip settings" onClick={() => setEffectSelection({clipId:clip.id,key:effectPage,view:'inline'})}><ArrowLeft size={14}/>Clip settings</button>
        <VisualEffectsControls key={`${clip.id}-${effectPage}`} clip={clip} onlyEffect={effectPage} onChange={onChange} onPreview={onPreviewEffects}/>
      </div> : visual && clip ? <div className="inspector-clip-settings">
        <FootageSettings key={`footage-${clip.id}`} fps={timeline?.fps} time={time} onSeek={onSeek} aspectRatio={timeline?.aspectRatio} readOnly={readOnly} clip={clip} audioClip={audioClip} asset={asset} onChange={onChange} onPreview={onPreviewEffects} onPlaybackRateChange={onPlaybackRateChange} onCrop={onCrop} cropping={cropping}/>
        {backgroundRemoval && clip.kind === 'video' && <BackgroundRemovalControl projectId={backgroundRemoval.projectId} clip={clip} asset={asset} readOnly={readOnly}/>}
        <AppliedVisualEffects key={`effects-${clip.id}`} clip={clip} expandedEffect={expandedEffect} onSelect={key => setEffectSelection(key ? { clipId: clip.id, key, view:'inline' } : null)} onChange={onChange} onPreview={onPreviewEffects} onAdd={() => setTab('sources')}/>
      </div> : transitionControls ? transitionControls : solidControls ? solidControls : zoomBlurControls ? zoomBlurControls : barControls ? barControls : frameControls ? frameControls : zoomControls ? zoomControls : motionControls ? motionControls : clip?.kind === 'audio' && onPlaybackRateChange ? <PlaybackSpeedControls clip={clip} onChange={onPlaybackRateChange}/> : effect && clip ? <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>{effectClipLabel(clip)}</p><span>Move, trim, or delete this effect on the timeline.</span></div> : <div className="inspector-empty"><Layers size={22} strokeWidth={1.2}/><p>Select a visual clip</p><span>Choose footage for effects or a text clip to animate it.</span></div>}
    </div>}
    </TabsContent>}
  </aside></Tabs>;
}
