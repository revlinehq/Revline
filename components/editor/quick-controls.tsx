'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { applyQuickLayout, HOOK_MAX_LENGTH, hookText, layoutState, removeSubtitles, savedSubtitles, setHook, spokenAssetIds, subtitleState, subtitlesFromTranscripts} from '@/lib/editor/quick-controls';
import type { MediaAsset, Timeline } from '@/lib/editor/types';
import { userError } from '@/lib/user-error';
import { useEditorStore, useEditorState } from './editor-state';
import './quick-controls.css';

const HOOK_TYPING_PAUSE_MS = 400;

/**
 * Subtitles on/off, blur background or tight crop, and a hook line for the open timeline. Each change goes
 * through `onChange`, the editor's normal edit path, so it saves, shows live and undoes like any other edit.
 */
export function QuickControls({ timeline, assets, locked, onChange, onError, onLoadAsset }: {
  timeline: Timeline; assets: MediaAsset[]; locked: boolean;
  onChange: (next: Timeline) => void; onError: (message: string) => void;
  /** Loads one source with its saved analysis; the editor's media list leaves transcripts out. */
  onLoadAsset?: (assetId: string) => Promise<MediaAsset>;
}) {
  const store = useEditorStore(), history = useEditorState(state => state.history);
  const [captioning, setCaptioning] = useState(false);
  const subtitles = useMemo(() => subtitleState(timeline, assets, history), [timeline, assets, history]);
  const layout = useMemo(() => layoutState(timeline, assets), [timeline, assets]);
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

  return <div className="quick-controls" role="group" aria-label="Quick clip controls">
    <div className="quick-control">
      <span className="quick-control-label" id="quick-subtitles-label">Subtitles</span>
      <ToggleGroup type="single" spacing={0} className="quick-toggle" aria-labelledby="quick-subtitles-label" disabled={locked || captioning || !!subtitles.disabled} value={subtitles.on ? 'on' : 'off'} onValueChange={next => { if (next) void setSubtitles(next === 'on'); }}>
        <ToggleGroupItem value="on">On</ToggleGroupItem>
        <ToggleGroupItem value="off">Off</ToggleGroupItem>
      </ToggleGroup>
      {subtitles.disabled && <span className="quick-control-hint">{subtitles.disabled}</span>}
    </div>
    <div className="quick-control">
      <span className="quick-control-label" id="quick-layout-label">Layout</span>
      <ToggleGroup type="single" spacing={0} className="quick-toggle" aria-labelledby="quick-layout-label" disabled={locked || !!layout.disabled} value={layout.value === 'blur' || layout.value === 'crop' ? layout.value : ''} onValueChange={next => { const choice = next || layout.value; if (!locked && (choice === 'blur' || choice === 'crop')) attempt(() => applyQuickLayout(current(), assets, choice), 'Could not change the layout.'); }}>
        <ToggleGroupItem value="blur">Blur background</ToggleGroupItem>
        <ToggleGroupItem value="crop">Tight crop</ToggleGroupItem>
      </ToggleGroup>
      {(layout.disabled || layout.value === 'mixed') && <span className="quick-control-hint">{layout.disabled ?? 'Mixed'}</span>}
    </div>
    <div className="quick-control quick-control-hook">
      <label className="quick-control-label" htmlFor="quick-hook">Hook</label>
      <Input id="quick-hook" className="quick-hook-input" type="text" autoComplete="off" maxLength={HOOK_MAX_LENGTH} placeholder="Type a hook line" disabled={locked} value={draft}
        onChange={event => typeHook(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') commitHook(draft); }}
        onBlur={() => { commitHook(draft); store.getState().endUndoGroup(); }}/>
    </div>
  </div>;
}
