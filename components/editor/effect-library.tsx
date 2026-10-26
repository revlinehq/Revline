'use client';

import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { ChevronRight, FolderOpen, Plus, Search } from 'lucide-react';
import { EffectIcon } from './effect-icon';
import type { EffectPreset } from '@/lib/editor/clip-effects';
import { selectedTextLook, type TextLookId } from '@/lib/editor/text-looks';
import { TextFontStyles } from './text-font-styles';
import type { ColorLookId } from '@/lib/editor/color-looks';
import type { VisualEffects } from '@/lib/editor/visual-effects';
import type { Clip, MediaAsset, Timeline } from '@/lib/editor/types';
import { isTransitionPreset, type TransitionPreset } from '@/lib/editor/clip-transitions';
import { transitionAvailabilityAt } from '@/lib/editor/transition-placement';
import { EFFECT_DRAG_TYPE } from '@/lib/editor/effect-drag';
import { EFFECT_LIBRARY_CATALOG, EFFECT_LIBRARY_CATEGORIES, type EffectLibraryCategory, type EffectLibraryEntry as LibraryEntryData } from './effect-library-catalog';
import './effect-library.css';

const TextLookPicker = lazy(() => import('./text-look-picker').then(module => ({ default: module.TextLookPicker })));
const DevRemotionTests = process.env.NODE_ENV === 'development' ? lazy(() => import('../dev/remotion-dev-tests').then(module => ({ default: module.RemotionDevTests }))) : null;
const DevCutoutEffectsLab = process.env.NODE_ENV === 'development' ? lazy(() => import('../dev/cutout-effects-lab').then(module => ({ default: module.CutoutEffectsLab }))) : null;
const AudioFxLibrary = lazy(() => import('./sfx-library').then(module => ({ default: module.SfxLibrary })));
export type LibraryVisualEffect = keyof VisualEffects;
type LibraryShortcutCategory = EffectLibraryCategory | 'text' | 'audio-fx';
type LibraryCategory = LibraryShortcutCategory | 'sam-dev' | 'remotion-dev';

function LibraryEntry({ entry, disabled, reason, draggable, onApply }: { entry: LibraryEntryData; disabled: boolean; reason?: string; draggable: boolean; onApply: () => void }) {
  return <button type="button" className="library-look" aria-disabled={disabled} draggable={draggable} aria-label={entry.label} title={reason || entry.description} onClick={() => { if (!disabled) onApply(); }} onDragStart={event => {
    if (!draggable || (!entry.visual && !entry.preset)) { event.preventDefault(); return; }
    event.dataTransfer.setData(EFFECT_DRAG_TYPE, JSON.stringify(entry.visual ? { visual: entry.visual } : { preset: entry.preset }));
    event.dataTransfer.effectAllowed = 'copy';
  }}><EffectIcon name={entry.id} size={18}/><span>{entry.label}</span>{entry.action ? <ChevronRight size={12} aria-hidden="true"/> : <Plus size={12} aria-hidden="true"/>}</button>;
}

export function EffectLibrary({ cutoutLab, clip, timeline, time = 0, assets, onMedia, onVisualEffect, onColorLook, onAddEffect, onAddTransition, onTextLook, onSpeed, onAddSound, onAddStockAudio, onUploadSound, uploading = false }: {
  clip?: Clip; timeline?: Timeline; time?: number; assets: readonly MediaAsset[];
  /** Development-only cut-out effects lab; set when the project may use cut-outs. */
  cutoutLab?: { projectId: import('@/convex/_generated/dataModel').Id<'projects'> };
    onMedia?: () => void; onVisualEffect: (effect: LibraryVisualEffect) => void;
  onColorLook?: (look: ColorLookId) => void;
  onAddEffect?: (preset: EffectPreset) => void;
  onAddTransition?: (preset: TransitionPreset) => void;
  onTextLook?: (look: TextLookId) => void;
  onSpeed?: () => void;
  onAddSound?: (asset: MediaAsset) => void; onAddStockAudio?: (catalogId: string) => Promise<void>; onUploadSound?: () => void; uploading?: boolean;
}) {
  const [category, setCategory] = useState<LibraryCategory>('texture');
  const [search, setSearch] = useState('');
  const id = useId();
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const query = search.trim().toLowerCase();
  const catalog = EFFECT_LIBRARY_CATALOG.filter(entry => !isTransitionPreset(entry.preset) || onAddTransition);
  const categories: { id: LibraryCategory; label: string }[] = EFFECT_LIBRARY_CATEGORIES.filter(item => catalog.some(entry => entry.category === item.id));
  categories.push({ id: 'text', label: 'Text' });
  if (process.env.NODE_ENV === 'development') categories.push({ id: 'sam-dev', label: 'SAM 3 (dev)' }, { id: 'remotion-dev', label: 'Remotion (dev)' });
  // Audio FX is hidden; the assistant still places library sounds on request.
  // categories.push({ id: 'audio-fx', label: 'Audio FX' });
  const visible = catalog.filter(entry => (!entry.action || onSpeed) && (query ? `${entry.label} ${entry.description}`.toLowerCase().includes(query) : entry.category === category));
  const needsTransitions = category !== 'text' && category !== 'audio-fx' && category !== 'remotion-dev' && visible.some(entry => isTransitionPreset(entry.preset));
  const transitionTarget = visual ? clip.id : undefined;
  const transitions = useMemo(() => needsTransitions && timeline ? transitionAvailabilityAt(timeline, time, { aboveClipId: transitionTarget }) : { available: false as const, reason: 'Add video or image footage before adding a transition.' }, [needsTransitions, timeline, time, transitionTarget]);
  const canDragTransition = needsTransitions && !!timeline?.clips.some(item => (item.kind === 'video' || item.kind === 'image') && item.duration >= 2 / timeline.fps);
  function reason(entry: LibraryEntryData) {
    if (isTransitionPreset(entry.preset) && !transitions.available) return transitions.reason;
    if (entry.visual && !visual) return 'Select a video or image clip first.';
    if (entry.action && clip?.kind !== 'video' && clip?.kind !== 'audio') return 'Select a video or audio clip first.';
    if (entry.preset && !isTransitionPreset(entry.preset) && !onAddEffect) return 'Effect editing is unavailable.';
  }
  function apply(entry: LibraryEntryData) {
    if (entry.visual) onVisualEffect(entry.visual);
    else if (isTransitionPreset(entry.preset)) onAddTransition?.(entry.preset);
    else if (entry.preset) onAddEffect?.(entry.preset);
    else onSpeed?.();
  }
  function selectCategory(next: LibraryCategory) { setCategory(next); setSearch(''); }
  return <div className="effect-library" aria-label="Effect library">
    {onMedia && <button type="button" className="library-media-access" onClick={onMedia}><FolderOpen size={14}/><span>Your media</span><ChevronRight size={14}/></button>}
    <label className="library-search"><Search size={13}/><input aria-label="Search effects" placeholder="Search tools" value={search} onChange={event => setSearch(event.target.value)}/></label>
    <div className="library-category-layout">
        <div className="library-category-rail" role="tablist" aria-label="Effect categories" aria-orientation="vertical" onKeyDown={event => {
          if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
          const current = categories.findIndex(item => item.id === category);
          const next = event.key === 'ArrowDown' ? (current + 1) % categories.length : event.key === 'ArrowUp' ? (current + categories.length - 1) % categories.length : event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : undefined;
          if (next === undefined) return;
          event.preventDefault(); selectCategory(categories[next].id);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{categories.map(item => <button key={item.id} type="button" role="tab" id={`${id}-category-${item.id}`} data-category={item.id} aria-controls={`${id}-category-results`} aria-selected={category === item.id} tabIndex={category === item.id ? 0 : -1} onClick={() => selectCategory(item.id)}>{item.label}</button>)}</div>
        <div className="library-category-results" id={`${id}-category-results`} role={query ? 'region' : 'tabpanel'} aria-label={query ? category === 'text' ? 'Text search results' : category === 'audio-fx' ? 'Audio FX search results' : 'Effect search results' : undefined} aria-labelledby={query ? undefined : `${id}-category-${category}`}>
          {category === 'text' ? <div className="library-text-results">
            <TextFontStyles/>
            <section className="library-text-section"><h3>{text ? 'Presets' : 'Add text'}</h3><Suspense fallback={<p className="library-selection-note">Loading presets…</p>}><TextLookPicker query={search} selected={text ? selectedTextLook(clip) : undefined} onSelect={onTextLook}/></Suspense></section>
          </div> : category === 'sam-dev' && DevCutoutEffectsLab && !query ? (cutoutLab ? <Suspense fallback={<p className="library-selection-note">Loading cut-out effects…</p>}><DevCutoutEffectsLab projectId={cutoutLab.projectId} clip={clip} asset={assets.find(asset => asset._id === clip?.assetId)}/></Suspense> : <p className="library-selection-note">Cut-out effects need a saved project.</p>) : category === 'remotion-dev' && DevRemotionTests ? <Suspense fallback={<div className="library-look-grid" aria-label="Loading motion experiments" aria-busy="true">{[0,1,2].map(key=><div key={key} className="h-20 rounded-md bg-current/5 animate-pulse"/>)}</div>}><DevRemotionTests embedded query={search}/></Suspense> : category === 'audio-fx'  ? <Suspense fallback={<div className="library-look-grid" aria-label="Loading sounds" aria-busy="true">{[0, 1, 2].map(key => <div key={key} className="h-9 rounded-md bg-current/5 animate-pulse"/>)}</div>}><AudioFxLibrary assets={assets} query={search} onAdd={onAddSound} onAddStockAudio={onAddStockAudio} onUpload={onUploadSound} uploading={uploading}/></Suspense> : category === 'sam-dev' && !query ? <section className="library-sam-dev"><h3>Subject masks</h3><a href="/dev/sam" target="_blank" rel="noopener noreferrer">Open mask lab <ChevronRight size={13}/></a></section> : <div className="library-look-grid">{visible.map(entry => {
            const unavailable = reason(entry);
            const draggable = !!entry.visual || (isTransitionPreset(entry.preset) ? !!canDragTransition : !!entry.preset && !!onAddEffect);
            return <LibraryEntry key={entry.id} entry={entry} disabled={!!unavailable} reason={unavailable} draggable={draggable} onApply={() => apply(entry)}/>;
          })}</div>}
          {category !== 'text' && category !== 'remotion-dev' && category !== 'audio-fx' && !visible.length && (category !== 'sam-dev' || query) && <p className="library-empty">No matching looks.</p>}
          {category !== 'text' && category !== 'remotion-dev' && category !== 'audio-fx' && !transitions.available && visible.some(entry => isTransitionPreset(entry.preset)) && <p className="library-transition-availability" role="status">{transitions.reason}</p>}
        </div>
    </div>
  </div>;
}
