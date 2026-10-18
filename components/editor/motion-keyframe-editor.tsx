'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { motionAt, type MotionKeyframe } from '@/lib/editor/clip-effects';
import { CAMERA_ZOOM_RANGE } from '@/lib/editor/smooth-zoom-settings';
import type { Clip } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import { InspectorSelect } from './inspector-select';
import './motion-keyframe-editor.css';

type Props = { clip: Clip; fps: number; time: number; disabled: boolean; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void; onSeek?: (time: number) => void };
const properties = {
  scale: { label: 'Scale', unit: '%', factor: 100, min: .1, max: CAMERA_ZOOM_RANGE[1] },
  x: { label: 'Position X', unit: '%', factor: 100, min: -1, max: 1 },
  y: { label: 'Position Y', unit: '%', factor: 100, min: -1, max: 1 },
  rotation: { label: 'Rotation', unit: '°', factor: 1, min: -360, max: 360 },
  opacity: { label: 'Opacity', unit: '%', factor: 100, min: 0, max: 1 },
} as const;
type Property = keyof typeof properties;
type Drag = { pointer: number; target: HTMLButtonElement; index: number; keys: MotionKeyframe[]; next: MotionKeyframe[]; clipId: string };

export function MotionKeyframeEditor(props: Props) {
  return process.env.NODE_ENV !== 'production' ? <DevelopmentKeyframes key={props.clip.id} {...props}/> : null;
}

function DevelopmentKeyframes({ clip, fps, time, disabled, onChange, onPreview, onSeek }: Props) {
  const [property, setProperty] = useState<Property>('scale');
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<MotionKeyframe[] | null>(null);
  const [zoom, setZoom] = useState('1');
  const plot = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ clip, disabled, onChange, onPreview });
  latest.current = { clip, disabled, onChange, onPreview };
  const keys = draft ?? clip.motion ?? [];
  const offset = clip.motionOffset ?? 0;
  const duration = Math.max(clip.duration, 1 / fps);
  const localTime = Math.max(0, Math.min(duration, time - clip.start));
  const visible = keys.map((key, index) => ({ key, index })).filter(({ key }) => key.time >= offset && key.time <= offset + duration);
  const meta = properties[property];
  const samples = keys.length ? [motionAt(keys, offset), ...visible.map(({ key }) => key), motionAt(keys, offset + duration)] : [];
  const values = samples.map(key => key[property]);
  const low = Math.min(...values, property === 'scale' || property === 'opacity' ? 1 : 0);
  const high = Math.max(...values, low + (property === 'rotation' ? 10 : .1));
  const y = (value: number) => 78 - (value - low) / (high - low) * 58;
  const x = (value: number) => (value - offset) / duration * 100;
  const selectedKey = selected === null ? undefined : keys[selected];

  function cancel() {
    const gesture = drag.current; drag.current = null;
    if (gesture?.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer);
    setDraft(null); latest.current.onPreview?.(null);
  }
  useEffect(() => { cancel(); }, [disabled, clip.motion, clip.motionOffset]);
  useEffect(() => () => { drag.current = null; latest.current.onPreview?.(null); }, []);
  function commit(next: MotionKeyframe[]) {
    if (latest.current.disabled) return;
    onPreview?.(null);
    onChange({ motion: next.length ? next : undefined, smoothZoom: undefined, cameraMotion:undefined });
  }
  function setKey(index: number, changes: Partial<MotionKeyframe>) {
    const next = keys.map((key, current) => current === index ? { ...key, ...changes } : key);
    commit(next);
  }
  function bounds(index: number) {
    return { min: Math.max(offset, (keys[index - 1]?.time ?? -Infinity) + .000001), max: Math.min(offset + duration, (keys[index + 1]?.time ?? Infinity) - .000001) };
  }
  function seekAt(event: PointerEvent<HTMLDivElement>) {
    if (disabled || !onSeek) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(clip.start + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration);
  }
  function start(event: PointerEvent<HTMLButtonElement>, index: number) {
    if (disabled || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); setSelected(index);
    onSeek?.(clip.start + keys[index].time - offset);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, target: event.currentTarget, index, keys, next: keys, clipId: clip.id };
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current, rect = plot.current?.getBoundingClientRect();
    if (!gesture || gesture.pointer !== event.pointerId || !rect || disabled) return;
    const limits = bounds(gesture.index);
    const snapped = Math.round((event.clientX - rect.left) / rect.width * duration * fps) / fps + offset;
    const at = Math.max(limits.min, Math.min(limits.max, snapped));
    gesture.next = gesture.keys.map((key, index) => index === gesture.index ? { ...key, time: at } : key);
    setDraft(gesture.next); onPreview?.({ motion: gesture.next, smoothZoom: undefined, cameraMotion:undefined });
    onSeek?.(clip.start + at - offset);
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    drag.current = null;
    if (!latest.current.disabled && latest.current.clip.id === gesture.clipId && latest.current.clip.motion === gesture.keys && gesture.next !== gesture.keys) commit(gesture.next);
    else onPreview?.(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDraft(null);
  }
  function add() {
    if (disabled) return;
    const at = Math.round(localTime * fps) / fps + offset;
    const existing = keys.findIndex(key => Math.abs(key.time - at) < .000001);
    if (existing !== -1) { setSelected(existing); return; }
    const next = [...keys, motionAt(keys, at)].sort((a, b) => a.time - b.time);
    setSelected(next.findIndex(key => key.time === at)); commit(next);
  }

  return <details className="footage-disclosure motion-keyframe-editor" open>
    <summary><span>Keyframes <small>Development</small></span><ChevronDown size={12}/></summary>
    <div className="footage-settings-section">
      <div className="keyframe-toolbar"><InspectorSelect label="Keyframe property" value={property} options={Object.entries(properties).map(([value, item]) => ({ value: value as Property, label: item.label }))} onChange={setProperty}/><InspectorSelect label="Keyframe timeline zoom" value={zoom} options={['1','2','4'].map(value => ({value,label:`${value}×`}))} onChange={setZoom}/></div>
      <div className="keyframe-scroll"><div className="keyframe-canvas" style={{ width: `${Number(zoom) * 100}%` }}>
        <div className="keyframe-ruler" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index} style={{ left: `${index * 25}%` }}>{(duration * index / 4).toFixed(2)}s</span>)}</div>
        <div ref={plot} className="keyframe-plot" onPointerDown={event => { if (event.button !== 0 || disabled) return; event.currentTarget.setPointerCapture(event.pointerId); seekAt(event); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekAt(event); }} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points={samples.map(key => `${x(key.time)},${y(key[property])}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></svg>
          {visible.map(({ key, index }) => <button key={index} type="button" className="keyframe-diamond" style={{ left: `${x(key.time)}%`, top: `${y(key[property])}%` }} disabled={disabled} aria-label={`Keyframe ${index + 1}, ${(key.time - offset).toFixed(3)} seconds, ${meta.label} ${(key[property] * meta.factor).toFixed(1)}${meta.unit}`} aria-pressed={selected === index} onFocus={() => setSelected(index)} onClick={() => { setSelected(index); if (!disabled) onSeek?.(clip.start + key.time - offset); }} onPointerDown={event => start(event, index)} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); cancel(); } if (!disabled && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); event.stopPropagation(); const limits = bounds(index); setKey(index, { time: Math.max(limits.min, Math.min(limits.max, key.time + (event.key === 'ArrowRight' ? 1 : -1) / fps)) }); } }}><span/></button>)}
          <div className="keyframe-playhead" style={{ left: `${localTime / duration * 100}%` }} aria-hidden="true"/>
        </div>
      </div></div>
      <input className="keyframe-scrubber" type="range" aria-label="Scrub selected clip keyframes" min={0} max={duration} step={1 / fps} value={localTime} disabled={disabled || !onSeek} onChange={event => onSeek?.(clip.start + Number(event.target.value))}/>
      <div className="keyframe-status"><span>{visible.length} saved points · Linear interpolation</span><span>{localTime.toFixed(2)}s</span></div>
      {!keys.length && <p className="smooth-zoom-note">No motion saved. Ask the agent to add a smooth zoom, or add a point at the playhead.</p>}
      {clip.cameraMotion && <p className="smooth-zoom-note">The agent’s camera path is sampled into these points. Editing a point converts it to custom motion.</p>}
      {clip.smoothZoom && <p className="smooth-zoom-note">The agent’s {clip.smoothZoom.easing.replaceAll('-', ' ')} zoom is sampled into these points. Editing a point converts it to custom motion.</p>}
      {selectedKey && selected !== null && <div className="smooth-zoom-timing"><NumberControl label="Keyframe time" value={selectedKey.time - offset} min={bounds(selected).min - offset} max={bounds(selected).max - offset} step={1 / fps} unit="s" disabled={disabled} onCommit={value => setKey(selected, { time: value + offset })}/><NumberControl label={`Keyframe ${meta.label.toLowerCase()}`} value={selectedKey[property] * meta.factor} min={meta.min * meta.factor} max={meta.max * meta.factor} step={property === 'rotation' ? 1 : .1} unit={meta.unit} disabled={disabled} onCommit={value => setKey(selected, { [property]: value / meta.factor })}/></div>}
      <div className="smooth-zoom-actions"><button type="button" className="footage-crop" disabled={disabled} onClick={add}><Plus size={12}/>Add point</button><button type="button" className="footage-crop" disabled={disabled || !selectedKey} onClick={() => { commit(keys.filter((_, index) => index !== selected)); setSelected(null); }}><Trash2 size={12}/>Remove point</button></div>
    </div>
  </details>;
}
