'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BLUR_REGION_STRENGTH, frameMappable, normalizeBlurRegion, regionLocalTime, regionSourceTime } from '@/lib/editor/blur-regions';
import { patchClip } from '@/lib/editor/operations';
import type { BlurRegion, Clip, Timeline } from '@/lib/editor/types';
import { useEditorState, useEditorStore } from './editor-state';

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The Effects tab's blur regions for the selected video clip: Draw turns the preview into a region editor
 * (components/editor/region-controls.tsx), and each region gets its style, strength and optional in/out
 * times in clip seconds. Every change is a normal timeline edit, so it saves, shows live and undoes.
 */
export function BlurRegionsRow({ timeline, locked, onChange }: { timeline: Timeline; locked: boolean; onChange: (next: Timeline) => void }) {
  const store = useEditorStore(), selectedId = useEditorState(state => state.selectedId), edit = useEditorState(state => state.regionEdit);
  const clip = timeline.clips.find(item => item.id === selectedId && item.kind === 'video');
  const regions = clip?.blurRegions ?? [];
  const drawing = !!clip && edit?.clipId === clip.id;
  const selected = drawing ? edit!.index : null;
  const setEdit = (index: number | null) => { if (clip) store.setState({ regionEdit: { clipId: clip.id, index } }); };
  const save = (next: BlurRegion[]) => {
    if (!clip || locked) return;
    const current = store.getState().timeline;
    onChange(patchClip(current, clip.id, { blurRegions: next.length ? next : undefined }));
  };
  const update = (index: number, patch: Partial<BlurRegion>) => {
    const next = normalizeBlurRegion({ ...regions[index], ...patch });
    // An out before its in would not save; the field shows the saved value again.
    if (next.start !== undefined && next.end !== undefined && next.end <= next.start) return;
    save(regions.map((region, at) => at === index ? next : region));
  };
  const remove = (index: number) => { save(regions.filter((_, at) => at !== index)); if (drawing) setEdit(null); };

  if (!clip) return <section className="effect-row">
    <span className="effect-label">Blur region</span>
    <p className="effect-hint">Select a video clip to blur or pixelate part of it</p>
  </section>;
  const mappable = frameMappable(clip);
  return <section className="effect-row">
    <div className="effect-row-head">
      <span className="effect-label" id="effect-blur-regions-label">Blur region</span>
      <Button type="button" size="sm" variant="ghost" className="effect-row-action" disabled={locked || !mappable} onClick={() => store.setState({ regionEdit: drawing ? null : { clipId: clip.id, index: regions.length ? regions.length - 1 : null } })}>{drawing ? 'Done' : 'Draw'}</Button>
    </div>
    {!mappable ? <p className="effect-hint">Rotated or flipped clips: ask the assistant to blur a region</p>
      : !regions.length && <p className="effect-hint">{drawing ? 'Drag on the preview over what to hide' : 'Hide emails, names or faces in this clip'}</p>}
    {regions.map((region, index) => <div key={index} className="blur-region-item" data-selected={selected === index || undefined}>
      <div className="effect-row-head">
        <Button type="button" variant="ghost" size="sm" className="blur-region-name" onClick={() => setEdit(index)}>Region {index + 1}</Button>
        <Button type="button" size="icon" variant="ghost" className="blur-region-remove" aria-label={`Remove region ${index + 1}`} disabled={locked} onClick={() => remove(index)}><Trash2 size={14}/></Button>
      </div>
      <ToggleGroup type="single" spacing={0} className="effect-toggle" aria-label={`Region ${index + 1} style`} disabled={locked} value={region.mode} onValueChange={mode => { if (mode === 'blur' || mode === 'pixelate') update(index, { mode }); }}>
        <ToggleGroupItem value="blur">Blur</ToggleGroupItem>
        <ToggleGroupItem value="pixelate">Pixelate</ToggleGroupItem>
      </ToggleGroup>
      <div className="effect-size">
        <Slider className="effect-size-slider" aria-label={`Region ${index + 1} strength`} min={BLUR_REGION_STRENGTH[0]} max={BLUR_REGION_STRENGTH[1]} step={1} disabled={locked} value={[region.strength]}
          onValueChange={([strength]) => { store.getState().beginUndoGroup(`blur-region-strength-${index}`); update(index, { strength }); }} onValueCommit={() => store.getState().endUndoGroup()}/>
        <span className="blur-region-value">{region.strength}</span>
      </div>
      <div className="blur-region-times">
        <RegionTime label="In" value={region.start} clip={clip} disabled={locked} onCommit={start => update(index, { start })}/>
        <RegionTime label="Out" value={region.end} clip={clip} disabled={locked} onCommit={end => update(index, { end })}/>
      </div>
    </div>)}
  </section>;
}

/** An in or out time shown in clip seconds (saved in source seconds of the media); empty means the clip's own edge. */
function RegionTime({ label, value, clip, disabled, onCommit }: { label: string; value?: number; clip: Clip; disabled: boolean; onCommit: (value: number | undefined) => void }) {
  const shown = value === undefined ? '' : String(round(regionLocalTime(clip, value)));
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const commit = () => {
    const text = draft.trim(), number = Number(text);
    if (!text) { if (value !== undefined) onCommit(undefined); return; }
    if (!Number.isFinite(number) || number < 0) { setDraft(shown); return; }
    if (String(round(number)) !== shown) onCommit(regionSourceTime(clip, number));
  };
  return <label className="blur-region-time">
    <span>{label}</span>
    <Input className="effect-input" type="number" inputMode="decimal" min={0} step={0.1} placeholder={label === 'In' ? 'Start' : 'End'} disabled={disabled} value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}/>
  </label>;
}
