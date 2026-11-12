'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Captions, ChevronDown, Crop, MousePointerClick, Palette, Search, Type } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { appliedCaptionPreset, applyQuickCaptionPreset, applyQuickLayout, captionPresetTargets, captionTimingSources, HOOK_MAX_LENGTH, hookText, layoutState, removeSubtitles, savedSubtitles, setHook, spokenAssetIds, subtitleState, subtitlesFromTranscripts} from '@/lib/editor/quick-controls';
import { formatTime, type Clip, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { patchClip } from '@/lib/editor/operations';
import { userError } from '@/lib/user-error';
import type { CaptionPresetId } from '@/lib/editor/caption-presets';
import { CaptionPresetPicker } from './caption-preset-picker';
import { AppliedEffects, EFFECT_NAMES, appliedEffects } from './applied-effects';
import { MediaThumbnail } from './media-thumbnail';
import { useEditorStore, useEditorState } from './editor-state';
import './effects-panel.css';

const HOOK_TYPING_PAUSE_MS = 400;

/** A collapsible group in the panel: a title, a quiet note on the right, and its rows. */
function PanelSection({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return <Collapsible open={open} onOpenChange={setOpen} className="effect-section">
    <CollapsibleTrigger className="panel-section-head"><ChevronDown size={14} className="panel-section-chevron" aria-hidden="true"/><span className="panel-section-title">{title}</span>{meta && <span className="panel-section-meta">{meta}</span>}</CollapsibleTrigger>
    <CollapsibleContent className="effect-section-body">{children}</CollapsibleContent>
  </Collapsible>;
}

function clipTitle(clip: Clip, assets: MediaAsset[]) {
  if (clip.kind === 'caption' || clip.kind === 'graphic') return clip.text?.trim() || 'Text';
  return assets.find(asset => asset._id === clip.assetId)?.fileName ?? (clip.kind === 'solid' ? 'Color' : 'Clip');
}

const TIMELINE_ROWS = { subtitles: 'Subtitles', captions: 'Caption style', layout: 'Layout', hook: 'Hook' } as const;

/**
 * The side panel's Effects tab. A header names the selected clip; "Applied" lists the footage effects on it, each with
 * on/off, remove and its settings; "Whole timeline" holds the one-click changes to the open timeline (subtitles, a
 * caption style, blur background or tight crop, a hook line). Every change goes through `onChange`, the editor's normal
 * edit path, so it saves, shows live and undoes like any other edit.
 */
export function EffectsPanel({ timeline, timelineName, assets, locked, onChange, onError, onLoadAsset }: {
  timeline: Timeline; timelineName?: string; assets: MediaAsset[]; locked: boolean;
  onChange: (next: Timeline) => void; onError: (message: string) => void;
  /** Loads one source with its saved analysis; the editor's media list leaves transcripts out. */
  onLoadAsset?: (assetId: string) => Promise<MediaAsset>;
}) {
  const store = useEditorStore(), history = useEditorState(state => state.history);
  const [captioning, setCaptioning] = useState(false);
  const subtitles = useMemo(() => subtitleState(timeline, assets, history), [timeline, assets, history]);
  const layout = useMemo(() => layoutState(timeline, assets), [timeline, assets]);
  const selectedIds = useEditorState(state => state.selectedIds), selectedId = useEditorState(state => state.selectedId);
  const presetTargets = useMemo(() => captionPresetTargets(timeline, selectedIds?.length ? selectedIds : selectedId ? [selectedId] : []), [timeline, selectedIds, selectedId]);
  const presetApplied = useMemo(() => appliedCaptionPreset(timeline, presetTargets), [timeline, presetTargets]);
  const [styling, setStyling] = useState(false);
  const current = () => store.getState().timeline;
  const attempt = (edit: () => Timeline, fallback: string) => { try { const next = edit(); if (next !== current()) onChange(next); } catch (error) { onError(userError(error, fallback)); } };

  const setSubtitles = async (on: boolean) => {
    if (locked || captioning || on === subtitles.on) return;
    if (!on) return attempt(() => removeSubtitles(current()), 'Could not turn subtitles off.');
    const saved = savedSubtitles(current(), store.getState().history);
    if (saved) return onChange(saved);
    setCaptioning(true);
    try {
      const ids = spokenAssetIds(current(), assets);
      const sources = onLoadAsset ? await Promise.all(ids.map(onLoadAsset)) : assets.filter(asset => ids.includes(asset._id));
      // The timeline may have changed while the transcripts loaded.
      if (!current().clips.some(clip => clip.kind === 'caption')) onChange(subtitlesFromTranscripts(current(), sources, store.getState().history, () => crypto.randomUUID()));
    } catch (error) { onError(userError(error, 'Could not add subtitles.')); }
    finally { setCaptioning(false); }
  };

  // A preset times each word from the transcript beneath it, so captions without word timings load the transcripts first.
  const choosePreset = async (id: CaptionPresetId) => {
    if (locked || styling || !presetTargets.length) return;
    setStyling(true);
    try {
      // Only footage under captions without word timings, and only sources with a transcript.
      const spoken = new Set(spokenAssetIds(current(), assets)), ids = captionTimingSources(current(), presetTargets).filter(id => spoken.has(id));
      const sources = onLoadAsset ? await Promise.all(ids.map(onLoadAsset)) : assets.filter(asset => ids.includes(asset._id));
      const targets = presetTargets.filter(target => current().clips.some(clip => clip.id === target));
      if (targets.length) onChange(applyQuickCaptionPreset(current(), id, targets, sources));
    } catch (error) { onError(userError(error, 'Could not apply the caption preset.')); }
    finally { setStyling(false); }
  };

  // The field shows what is typed; the timeline follows after a short pause, on Enter and on leaving the field.
  const saved = hookText(timeline);
  const [draft, setDraft] = useState(saved), [seen, setSeen] = useState(saved);
  if (saved !== seen) { setSeen(saved); if (saved !== draft.trim()) setDraft(saved); }
  // While the editor is locked (an agent edit, a timeline switch) nothing typed can be saved: show what is saved.
  const [wasLocked, setWasLocked] = useState(locked);
  if (locked !== wasLocked) { setWasLocked(locked); if (locked) setDraft(saved); }
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A line still waiting for its pause is dropped, never written into another timeline; the undo step it opened is closed.
  const stopTyping = () => { if (pending.current) { clearTimeout(pending.current); pending.current = null; } store.getState().endUndoGroup(); };
  useEffect(() => { if (locked) stopTyping(); return stopTyping; }, [locked]); // eslint-disable-line react-hooks/exhaustive-deps
  const commitHook = (text: string) => {
    if (pending.current) { clearTimeout(pending.current); pending.current = null; }
    if (locked || text.trim() === hookText(current())) return;
    // One undo step for a whole line, not one per pause.
    store.getState().beginUndoGroup('quick-hook');
    attempt(() => setHook(current(), text), 'Could not set the hook.');
  };
  const typeHook = (text: string) => {
    setDraft(text);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => commitHook(text), HOOK_TYPING_PAUSE_MS);
  };

  const empty = !timeline.clips.length;
  // The header and "Applied" follow the one selected clip; several selected clips have no single header.
  const clip = selectedIds && selectedIds.length > 1 ? undefined : timeline.clips.find(item => item.id === selectedId);
  const applied = useMemo(() => appliedEffects(clip), [clip]);
  // The patch is built from the clip as it is in the store when the edit lands, so a newer change to it is kept.
  const patchSelected = (build: (clip: Clip) => Partial<Clip>, fallback: string) => {
    if (locked || !clip) return;
    attempt(() => { const live = current().clips.find(item => item.id === clip.id); return live ? patchClip(current(), live.id, build(live)) : current(); }, fallback);
  };
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase(), shows = (name: string) => !term || name.toLowerCase().includes(term);
  const shownApplied = applied.filter(effect => shows(EFFECT_NAMES[effect]));
  const visual = clip?.kind === 'video' || clip?.kind === 'image';
  const rows = (Object.keys(TIMELINE_ROWS) as (keyof typeof TIMELINE_ROWS)[]).filter(row => shows(TIMELINE_ROWS[row]));
  const asset = clip?.assetId ? assets.find(item => item._id === clip.assetId) : undefined;
  return <div className="effects-panel">
    <div className="effect-search relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"/>
      <Input className="effect-input pl-9" type="search" aria-label="Search effects" placeholder="Search effects" value={query} onChange={event => setQuery(event.target.value)}/>
    </div>
    {clip ? <div className="effect-target">
      <span className="effect-target-thumb">{asset && asset.kind !== 'audio' ? <MediaThumbnail asset={asset}/> : <Type size={18} strokeWidth={1.5}/>}</span>
      <span className="effect-target-text"><small>Applies to</small><strong title={clipTitle(clip, assets)}>{clipTitle(clip, assets)}</strong></span>
      <span className="effect-target-time">{formatTime(clip.start)} – {formatTime(clip.start + clip.duration)}</span>
    </div> : <div className="effect-target" data-empty>
      <span className="effect-target-thumb"><MousePointerClick size={18} strokeWidth={1.5}/></span>
      <span className="effect-target-text"><strong>{selectedIds && selectedIds.length > 1 ? `${selectedIds.length} clips selected` : 'Select a clip to apply effects'}</strong><small>{selectedIds && selectedIds.length > 1 ? 'Select one clip to see its effects.' : 'Click a clip in the timeline.'}</small></span>
    </div>}
    {clip && (term ? shownApplied.length > 0 : true) && <PanelSection title="Applied" meta={visual ? `${applied.length} on this clip` : undefined}>
      {visual ? <AppliedEffects key={clip.id} clip={clip} effects={shownApplied} locked={locked} onPatch={patchSelected}
        onBeginDrag={key => store.getState().beginUndoGroup(key)} onEndDrag={() => store.getState().endUndoGroup()}/>
        : <p className="effect-hint effect-applied-empty">Footage effects go on video and image clips.</p>}
    </PanelSection>}
    {rows.length > 0 && <PanelSection title="Whole timeline" meta={timelineName}>
    {rows.includes('subtitles') && <section className="effect-row">
      <div className="effect-row-head">
        <label className="effect-label" htmlFor="effect-subtitles"><Captions size={18} strokeWidth={1.5} aria-hidden="true"/>Subtitles</label>
        <Switch id="effect-subtitles" className="effect-switch" checked={subtitles.on} disabled={locked || captioning || !!subtitles.disabled} onCheckedChange={on => void setSubtitles(on)}/>
      </div>
      {subtitles.disabled && <p className="effect-hint">{subtitles.disabled}</p>}
    </section>}
    {rows.includes('captions') && <section className="effect-row">
      <span className="effect-label" id="effect-caption-presets-label"><Palette size={18} strokeWidth={1.5} aria-hidden="true"/>Caption style</span>
      <CaptionPresetPicker value={presetApplied} disabled={locked || styling || !presetTargets.length} onChoose={id => void choosePreset(id)}/>
      <p className="effect-hint">{!presetTargets.length ? 'Turn on subtitles to style them' : presetTargets.length < timeline.clips.filter(clip => clip.kind === 'caption').length ? `Applies to the ${presetTargets.length === 1 ? 'selected caption' : `${presetTargets.length} selected captions`}` : 'Applies to every caption'}</p>
    </section>}
    {rows.includes('layout') && <section className="effect-row">
      <div className="effect-row-head">
      <span className="effect-label" id="effect-layout-label"><Crop size={18} strokeWidth={1.5} aria-hidden="true"/>Layout</span>
      <ToggleGroup type="single" spacing={0} className="effect-toggle" aria-labelledby="effect-layout-label" disabled={locked || !!layout.disabled} value={layout.value === 'blur' || layout.value === 'crop' ? layout.value : ''} onValueChange={next => { const choice = next || layout.value; if (!locked && (choice === 'blur' || choice === 'crop')) attempt(() => applyQuickLayout(current(), assets, choice), 'Could not change the layout.'); }}>
        <ToggleGroupItem value="blur">Blur background</ToggleGroupItem>
        <ToggleGroupItem value="crop">Tight crop</ToggleGroupItem>
      </ToggleGroup>
      </div>
      {(layout.disabled || layout.value === 'mixed') && <p className="effect-hint">{layout.disabled ?? 'Clips use different layouts'}</p>}
    </section>}
    {rows.includes('hook') && <section className="effect-row">
      <div className="effect-row-head">
      <label className="effect-label" htmlFor="effect-hook"><Type size={18} strokeWidth={1.5} aria-hidden="true"/>Hook</label>
      <Input id="effect-hook" className="effect-input" type="text" autoComplete="off" maxLength={HOOK_MAX_LENGTH} placeholder="Type a hook" disabled={locked || empty} value={draft}
        onChange={event => typeHook(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') commitHook(draft); }}
        onBlur={() => { commitHook(draft); store.getState().endUndoGroup(); }}/>
      </div>
    </section>}
    </PanelSection>}
    {term && !rows.length && !shownApplied.length && <p className="effect-hint">No effects match “{query.trim()}”.</p>}
  </div>;
}
