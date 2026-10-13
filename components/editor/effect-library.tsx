'use client';

import { lazy, Suspense, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, Plus, Search, Upload } from 'lucide-react';
import { EffectIcon, type EffectIconName } from './effect-icon';
import { EFFECT_CATALOG, type EffectPreset } from '@/lib/editor/clip-effects';
import { REMOTION_TEXT_LABELS, REMOTION_TEXT_PRESETS, type RemotionTextPreset } from '@/lib/editor/remotion-text';
import type { VisualEffects } from '@/lib/editor/visual-effects';
import type { Clip, MediaAsset } from '@/lib/editor/types';
import { selectedSubtitleStyle, type SubtitleStyleId } from '@/lib/editor/subtitle-styles';
import { SubtitleStylePicker } from './subtitle-style-picker';
import { MediaThumbnail } from './media-thumbnail';
import { OVERLAY_CATALOG, type OverlayCatalogItem } from '@/lib/editor/overlay-catalog';
const NO_OVERLAY_ASSETS: readonly MediaAsset[] = [];
import { EFFECT_DRAG_TYPE } from '@/lib/editor/effect-drag';
import './effect-library.css';

const TextPresetPicker = lazy(() => import('./text-preset-picker'));

export type LibraryVisualEffect = keyof VisualEffects;
type LibraryLook = { id: EffectIconName; label: string; description: string; visual?: LibraryVisualEffect; preset?: EffectPreset };
const featured: LibraryLook[] = [
  { id: 'dither', label: 'Dither', description: 'Ordered dots and a reduced color palette', visual: 'dither' },
  { id: 'glitch', label: 'Digital glitch', description: 'Distort the selected footage', visual: 'glitch' },
  { id: 'zoomBlur', label: 'Zoom blur', description: 'A timed blur pulse above your footage', preset: 'zoom-blur' },
  { id: 'cinematic-bars', label: 'Cinema bars', description: 'Black bars slide in and out', preset: 'cinematic-bars' },
  { id: 'quick-zoom-in', label: 'Zoom in', description: 'Push toward your subject', preset: 'quick-zoom-in' },
  { id: 'quick-zoom-out', label: 'Zoom out', description: 'Pull back to reveal the scene', preset: 'quick-zoom-out' },
];
const more: LibraryLook[] = [
  { id: 'colorGrade', label: 'Color & light', description: 'Adjust the selected footage', visual: 'colorGrade' },
  { id: 'invert', label: 'Invert colors', description: 'Turn colors into a negative', visual: 'invert' },
  ...(['flash', 'punch', 'shake', 'pop', 'fade'] as const).map(preset => ({ id: preset, label: EFFECT_CATALOG[preset].label, description: 'Add at the playhead', preset })),
];
const tabs = ['effects', 'text', 'overlays'] as const;
type LibraryTab = typeof tabs[number];

export function EffectLibrary({ clip, assets, onMedia, onVisualEffect, onAddEffect, onTextTemplate, onSubtitleStyle, onUploadOverlay, onAddOverlay, overlayAssets = NO_OVERLAY_ASSETS, onAddCatalogOverlay, onFadeThroughBlack, onSpeed }: {
  clip?: Clip; assets: readonly MediaAsset[];
  onMedia: () => void; onVisualEffect: (effect: LibraryVisualEffect) => void;
  onAddEffect?: (preset: EffectPreset) => void; onTextTemplate?: (preset: RemotionTextPreset) => void;
  onSubtitleStyle?: (style: SubtitleStyleId) => void;
  onUploadOverlay?: () => void; onAddOverlay?: (asset: MediaAsset) => void; overlayAssets?: readonly MediaAsset[]; onAddCatalogOverlay?: (overlay: OverlayCatalogItem) => void;
  onFadeThroughBlack?: () => void; onSpeed?: () => void;
}) {
  const [tab, setTab] = useState<LibraryTab>('effects');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const query = tab === 'overlays' ? search.trim().toLowerCase() : '';
  const matches = (label: string) => label.toLowerCase().includes(query);
  const visible = (expanded || query ? [...featured, ...more] : featured).filter(look => matches(look.label));
  const templates = REMOTION_TEXT_PRESETS.filter(preset => matches(REMOTION_TEXT_LABELS[preset]));
  const overlays = useMemo(() => tab === 'overlays' ? overlayAssets.filter(asset => asset.kind !== 'audio' && asset.fileName.toLowerCase().includes(query)) : [], [overlayAssets, query, tab]);
  const catalogOverlays = tab === 'overlays' ? OVERLAY_CATALOG.filter(overlay => overlay.title.toLowerCase().includes(query)) : [];
  const disabled = (look: LibraryLook) => look.visual ? !visual : !onAddEffect;
  const apply = (look: LibraryLook) => { if (look.visual) onVisualEffect(look.visual); else if (look.preset) onAddEffect?.(look.preset); };
  return <div className="effect-library" aria-label="Sources and effect library">
    <button type="button" className="library-media-access" onClick={onMedia}><FolderOpen size={14}/><span>Your media</span><ChevronRight size={14}/></button>
    <div className="library-tabs" role="tablist" aria-label="Effect library" onKeyDown={event => {
      if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : undefined;
      if (!next) return;
      event.preventDefault(); setTab(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`[data-library-tab="${next}"]`)?.focus();
    }}>{tabs.map(item => <button key={item} id={`${id}-${item}-tab`} data-library-tab={item} type="button" role="tab" aria-selected={tab === item} aria-controls={`${id}-${item}`} tabIndex={tab === item ? 0 : -1} onClick={() => setTab(item)}>{item === 'effects' ? 'Effects' : item === 'text' ? 'Text' : 'Overlays'}</button>)}</div>
    {tab === 'overlays' && <label className="library-search"><Search size={13}/><input aria-label="Search overlays" placeholder="Find an overlay" value={search} onChange={event => setSearch(event.target.value)}/></label>}
    <div role="tabpanel" id={`${id}-${tab}`} aria-labelledby={`${id}-${tab}-tab`}>
      {tab === 'effects' ? <>
        {!visual && <p className="library-selection-note">Drag an effect onto footage or the timeline. The + adds timed looks at the playhead.</p>}
        <div className="library-look-grid">{visible.map(look => <button key={look.id} type="button" className="library-look" aria-disabled={disabled(look)} draggable={!!look.visual || !!onAddEffect} onDragStart={event => { event.dataTransfer.setData(EFFECT_DRAG_TYPE, JSON.stringify(look.visual ? {visual:look.visual} : {preset:look.preset})); event.dataTransfer.effectAllowed = 'copy'; }} aria-label={look.label} title={look.visual && !visual ? 'Select a video or image clip first' : look.description} onClick={() => { if (!disabled(look)) apply(look); }}>
          <EffectIcon name={look.id} size={18}/><span>{look.label}</span><Plus size={12} aria-hidden="true"/>
        </button>)}</div>
        {!visible.length && <p className="library-empty">No matching looks.</p>}
        {matches('Fade through black') && onFadeThroughBlack && <section className="library-transitions" aria-label="Between clips"><p>Between clips</p><div className="library-look-grid"><button type="button" className="library-look" disabled={!visual} title={visual ? 'Fade through black at the end of this clip' : 'Select footage at the cut first'} onClick={onFadeThroughBlack}><EffectIcon name="fade-through-black" size={18}/><span>Fade through black</span><Plus size={12} aria-hidden="true"/></button></div></section>}
        {!query && <><button type="button" className="library-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><span>{expanded ? 'Fewer effects' : 'More effects'}</span><ChevronDown size={13}/></button>{expanded && onSpeed && <button type="button" className="library-simple-action" disabled={clip?.kind !== 'video' && clip?.kind !== 'audio'} onClick={onSpeed}>Change speed<ChevronRight size={13}/></button>}</>}
      </> : tab === 'text' ? <>
        {text && <p className="library-selection-note">Apply an animation to your selected text.</p>}
        <Suspense fallback={<p className="library-selection-note">Loading text templates…</p>}><TextPresetPicker presets={templates} selected={text ? clip?.textTemplate?.preset : undefined} onSelect={onTextTemplate}/></Suspense>
        {!templates.length && <p className="library-empty">No matching text templates.</p>}
        <SubtitleStylePicker selected={selectedSubtitleStyle(clip)} query={query} onSelect={onSubtitleStyle}/>
      </> : <>
        {onUploadOverlay && <button type="button" className="library-upload-overlay" onClick={onUploadOverlay}><Upload size={14}/>Upload an overlay<Plus size={13}/></button>}
        <p className="library-selection-note">Add media above your footage. Use Screen blend to hide a black background.</p>
        <div className="library-look-grid">{catalogOverlays.map(overlay => <button key={overlay.id} type="button" className="library-look library-overlay-look" disabled={!onAddCatalogOverlay} onClick={() => onAddCatalogOverlay?.(overlay)} title={`Add ${overlay.title} above footage`}><MediaThumbnail asset={{kind:overlay.kind,url:overlay.previewUrl}} className="library-overlay-thumbnail"/><span>{overlay.title}</span><Plus size={12} aria-hidden="true"/></button>)}{overlays.map(asset => <button key={asset._id} type="button" className="library-look library-overlay-look" disabled={!asset.url || !onAddOverlay} onClick={() => onAddOverlay?.(asset)} title={`Add ${asset.fileName} above footage`}><MediaThumbnail asset={asset} className="library-overlay-thumbnail"/><span>{asset.fileName}</span><Plus size={12} aria-hidden="true"/></button>)}</div>
        {!overlays.length && !catalogOverlays.length && <div className="library-empty"><p>{query ? 'No matching overlays.' : 'No overlays yet'}</p>{!query && <p>Light leaks, grain, and texture clips go here.</p>}</div>}
      </>}
    </div>
  </div>;
}
