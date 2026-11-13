'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { appliedCaptionPreset, applyQuickCaptionPreset, applyQuickLayout, captionPresetTargets, captionTimingSources, HOOK_MAX_LENGTH, hookClipIds, hookText, layoutState, setTextFont, textFontState, removeSubtitles, savedSubtitles, setHook, spokenAssetIds, subtitleState, subtitlesFromTranscripts} from '@/lib/editor/quick-controls';
import type { MediaAsset, Timeline } from '@/lib/editor/types';
import { userError } from '@/lib/user-error';
import type { CaptionPresetId } from '@/lib/editor/caption-presets';
import { CaptionPresetPicker } from './caption-preset-picker';
import { EffectTextFont } from './effect-text-font';
import type { TextFontId } from '@/lib/editor/text-fonts';
import { useEditorStore, useEditorState } from './editor-state';
import './effects-panel.css';

const HOOK_TYPING_PAUSE_MS = 400;

/**
 * The media panel's Effects tab: one-click changes to the open timeline, top to bottom. Subtitles on/off, a caption preset, blur
 * background or tight crop, and a hook line. Each change goes through `onChange`, the editor's normal edit path,
 * so it saves, shows live and undoes like any other edit. A further effect is one more `effect-row` below these.
 */
export function EffectsPanel({ timeline, assets, locked, onChange, onError, onLoadAsset }: {
  timeline: Timeline; assets: MediaAsset[]; locked: boolean;
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

  // Font and size: one undo step for a font choice, one for a whole slider drag or typed number.
  const hookIds = useMemo(() => hookClipIds(timeline), [timeline]);
  const captionFont = useMemo(() => textFontState(timeline, presetTargets), [timeline, presetTargets]);
  const hookFont = useMemo(() => textFontState(timeline, hookIds), [timeline, hookIds]);
  const chooseFont = (targets: string[], fontFamily: TextFontId) => { if (locked) return; store.getState().endUndoGroup(); attempt(() => setTextFont(current(), targets, { fontFamily }), 'Could not change the font.'); };
  const resize = (scope: string, targets: string[], fontSize: number) => { if (locked) return; store.getState().beginUndoGroup(`effect-size-${scope}`); attempt(() => setTextFont(current(), targets, { fontSize }), 'Could not change the size.'); };
  const endResize = () => store.getState().endUndoGroup();

  const empty = !timeline.clips.length;
  return <div className="effects-panel">
    <section className="effect-row">
      <div className="effect-row-head">
        <label className="effect-label" htmlFor="effect-subtitles">Subtitles</label>
        <Switch id="effect-subtitles" className="effect-switch" checked={subtitles.on} disabled={locked || captioning || !!subtitles.disabled} onCheckedChange={on => void setSubtitles(on)}/>
      </div>
      {subtitles.disabled && <p className="effect-hint">{subtitles.disabled}</p>}
    </section>
    <section className="effect-row">
      <span className="effect-label" id="effect-caption-presets-label">Caption presets</span>
      <CaptionPresetPicker value={presetApplied} disabled={locked || styling || !presetTargets.length} onChoose={id => void choosePreset(id)}/>
      <p className="effect-hint">{!presetTargets.length ? 'Turn on subtitles to style them' : presetTargets.length < timeline.clips.filter(clip => clip.kind === 'caption').length ? `Applies to the ${presetTargets.length === 1 ? 'selected caption' : `${presetTargets.length} selected captions`}` : 'Applies to every caption'}</p>
      {presetTargets.length > 0 && <EffectTextFont id="effect-caption" font={captionFont.font} size={captionFont.size} disabled={locked || styling}
        onFont={font => chooseFont(presetTargets, font)} onSize={size => resize('caption', presetTargets, size)} onSizeEnd={endResize}/>}
    </section>
    <section className="effect-row">
      <span className="effect-label" id="effect-layout-label">Layout</span>
      <ToggleGroup type="single" spacing={0} className="effect-toggle" aria-labelledby="effect-layout-label" disabled={locked || !!layout.disabled} value={layout.value === 'blur' || layout.value === 'crop' ? layout.value : ''} onValueChange={next => { const choice = next || layout.value; if (!locked && (choice === 'blur' || choice === 'crop')) attempt(() => applyQuickLayout(current(), assets, choice), 'Could not change the layout.'); }}>
        <ToggleGroupItem value="blur">Blur background</ToggleGroupItem>
        <ToggleGroupItem value="crop">Tight crop</ToggleGroupItem>
      </ToggleGroup>
      {(layout.disabled || layout.value === 'mixed') && <p className="effect-hint">{layout.disabled ?? 'Clips use different layouts'}</p>}
    </section>
    <section className="effect-row">
      <label className="effect-label" htmlFor="effect-hook">Hook</label>
      <Input id="effect-hook" className="effect-input" type="text" autoComplete="off" maxLength={HOOK_MAX_LENGTH} placeholder="Type a hook" disabled={locked || empty} value={draft}
        onChange={event => typeHook(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') commitHook(draft); }}
        onBlur={() => { commitHook(draft); store.getState().endUndoGroup(); }}/>
      {hookIds.length > 0 && <EffectTextFont id="effect-hook" font={hookFont.font} size={hookFont.size} disabled={locked}
        onFont={font => chooseFont(hookIds, font)} onSize={size => resize('hook', hookIds, size)} onSizeEnd={endResize}/>}
    </section>
  </div>;
}
