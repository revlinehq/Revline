'use client';

import { lazy, Suspense, useId, useState } from 'react';
import { ChevronRight, FolderOpen, Plus, Search } from 'lucide-react';
import { EffectIcon } from './effect-icon';
import type { EffectPreset } from '@/lib/editor/clip-effects';
import { selectedTextLook, type TextLookId } from '@/lib/editor/text-looks';
import { TextFontStyles } from './text-font-styles';
import type { VisualEffects } from '@/lib/editor/visual-effects';
import type { Clip, MediaAsset, Timeline } from '@/lib/editor/types';
import { isTransitionPreset, transitionAvailability, type TransitionPreset } from '@/lib/editor/clip-transitions';
import type { OverlayCatalogItem } from '@/lib/editor/overlay-catalog';
import { EFFECT_DRAG_TYPE } from '@/lib/editor/effect-drag';
import { SegmentedTabs } from './segmented-tabs';
import { EFFECT_LIBRARY_CATALOG, EFFECT_LIBRARY_CATEGORIES, type EffectLibraryCategory, type EffectLibraryEntry as LibraryEntryData } from './effect-library-catalog';
import './effect-library.css';

const TextLookPicker = lazy(() => import('./text-look-picker').then(module => ({ default: module.TextLookPicker })));
export type LibraryVisualEffect = keyof VisualEffects;
type LibraryTab = 'effects' | 'text';

function LibraryEntry({ entry, disabled, reason, draggable, onApply }: { entry: LibraryEntryData; disabled: boolean; reason?: string; draggable: boolean; onApply: () => void }) {
  return <button type="button" className="library-look" aria-disabled={disabled} draggable={draggable} aria-label={entry.label} title={reason || entry.description} onClick={() => { if (!disabled) onApply(); }} onDragStart={event => {
    if (!draggable || (!entry.visual && !entry.preset)) { event.preventDefault(); return; }
    event.dataTransfer.setData(EFFECT_DRAG_TYPE, JSON.stringify(entry.visual ? { visual: entry.visual } : { preset: entry.preset }));
    event.dataTransfer.effectAllowed = 'copy';
  }}><EffectIcon name={entry.id} size={18}/><span>{entry.label}</span>{entry.action ? <ChevronRight size={12} aria-hidden="true"/> : <Plus size={12} aria-hidden="true"/>}</button>;
}

export function EffectLibrary({ clip, timeline, time = 0, onMedia, onVisualEffect, onAddEffect, onAddTransition, onTextLook, onSpeed }: {
  clip?: Clip; timeline?: Timeline; time?: number; assets: readonly MediaAsset[];
  onMedia?: () => void; onVisualEffect: (effect: LibraryVisualEffect) => void;
  onAddEffect?: (preset: EffectPreset) => void;
  onAddTransition?: (preset: TransitionPreset) => void;
  onTextLook?: (look: TextLookId) => void;
  onUploadOverlay?: () => void; onAddOverlay?: (asset: MediaAsset) => void; overlayAssets?: readonly MediaAsset[]; onAddCatalogOverlay?: (overlay: OverlayCatalogItem) => void;
  onFadeThroughBlack?: () => void; onSpeed?: () => void;
}) {
  const [tab, setTab] = useState<LibraryTab>('effects');
  const [category, setCategory] = useState<EffectLibraryCategory>('motion');
  const [search, setSearch] = useState('');
  const id = useId();
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  const text = clip?.kind === 'caption' || clip?.kind === 'graphic';
  const query = search.trim().toLowerCase();
  const catalog = EFFECT_LIBRARY_CATALOG.filter(entry => !isTransitionPreset(entry.preset) || onAddTransition);
  const categories = EFFECT_LIBRARY_CATEGORIES.filter(item => catalog.some(entry => entry.category === item.id));
  const visible = catalog.filter(entry => (!entry.action || onSpeed) && (query ? `${entry.label} ${entry.description}`.toLowerCase().includes(query) : entry.category === category));
  const transitions = onAddTransition && timeline ? transitionAvailability(timeline, time, { aboveClipId: visual ? clip.id : undefined }) : { available: false as const, reason: 'Add neighboring video or image clips on one V track before adding a transition.' };
  const canDragTransition = onAddTransition && timeline ? transitionAvailability(timeline, time).available : false;
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
  function selectCategory(next: EffectLibraryCategory) { setCategory(next); setSearch(''); }
  return <div className="effect-library" aria-label="Effect library">
    {onMedia && <button type="button" className="library-media-access" onClick={onMedia}><FolderOpen size={14}/><span>Your media</span><ChevronRight size={14}/></button>}
    <SegmentedTabs className="library-tabs" label="Effect library" value={tab} onChange={setTab} options={[{ value: 'effects', label: 'Effects', id: `${id}-effects-tab`, panelId: `${id}-effects` }, { value: 'text', label: 'Text', id: `${id}-text-tab`, panelId: `${id}-text` }]}/>
    {tab === 'effects' && <label className="library-search"><Search size={13}/><input aria-label="Search effects" placeholder="Search effects" value={search} onChange={event => setSearch(event.target.value)}/></label>}
    <div className="library-tab-content" role="tabpanel" id={`${id}-${tab}`} aria-labelledby={`${id}-${tab}-tab`}>
      {tab === 'effects' ? <div className="library-category-layout">
        <div className="library-category-rail" role="tablist" aria-label="Effect categories" aria-orientation="vertical" onKeyDown={event => {
          if (!(event.target as HTMLElement).matches('[role="tab"]')) return;
          const current = categories.findIndex(item => item.id === category);
          const next = event.key === 'ArrowDown' ? (current + 1) % categories.length : event.key === 'ArrowUp' ? (current + categories.length - 1) % categories.length : event.key === 'Home' ? 0 : event.key === 'End' ? categories.length - 1 : undefined;
          if (next === undefined) return;
          event.preventDefault(); selectCategory(categories[next].id);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>{categories.map(item => <button key={item.id} type="button" role="tab" id={`${id}-category-${item.id}`} data-category={item.id} aria-controls={`${id}-category-results`} aria-selected={category === item.id} tabIndex={category === item.id ? 0 : -1} onClick={() => selectCategory(item.id)}>{item.label}</button>)}</div>
        <div className="library-category-results" id={`${id}-category-results`} role={query ? 'region' : 'tabpanel'} aria-label={query ? 'Effect search results' : undefined} aria-labelledby={query ? undefined : `${id}-category-${category}`}>
          <div className="library-look-grid">{visible.map(entry => {
            const unavailable = reason(entry);
            const draggable = !!entry.visual || (isTransitionPreset(entry.preset) ? !!canDragTransition : !!entry.preset && !!onAddEffect);
            return <LibraryEntry key={entry.id} entry={entry} disabled={!!unavailable} reason={unavailable} draggable={draggable} onApply={() => apply(entry)}/>;
          })}</div>
          {!visible.length && <p className="library-empty">No matching looks.</p>}
          {!transitions.available && visible.some(entry => isTransitionPreset(entry.preset)) && <p className="library-transition-availability" role="status">{transitions.reason}</p>}
        </div>
      </div> : <div className="library-text-results">
        <TextFontStyles/>
        <section className="library-text-section"><h3>{text ? 'Presets' : 'Add text'}</h3><Suspense fallback={<p className="library-selection-note">Loading presets…</p>}><TextLookPicker selected={text ? selectedTextLook(clip) : undefined} onSelect={onTextLook}/></Suspense></section>
      </div>}
    </div>
  </div>;
}
