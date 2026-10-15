'use client';

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChevronDown, ImagePlus, Move, Pause, Play, RotateCcw, Upload, X } from 'lucide-react';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { boundClipMotionLayer, clipMotionAnchors, clipMotionAt, clipMotionPoseAtPoint, moveClipMotionAnchor, updateClipMotionPose, CLIP_MOTION_PRESETS, DEFAULT_CLIP_MOTION_LAYERS, type ClipMotionLayer, type ClipMotionPoint, type ClipMotionPose } from './clip-motion-model';
import './clip-motion-lab.css';

const DEMO_IMAGE = '/images/editor-demo-poster.webp';
type LocalMedia = { name: string; url: string };
type PhotoMedia = Record<ClipMotionLayer['id'], LocalMedia | null>;
const cloneLayers = () => DEFAULT_CLIP_MOTION_LAYERS.map(layer => ({ ...layer }));
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="rmlab-field"><span>{label}</span>{children}</label>; }
const POINTS: { id: ClipMotionPoint; label: string }[] = [{ id: 'start', label: 'Start' }, { id: 'arrive', label: 'Arrive' }, { id: 'leave', label: 'Leave' }, { id: 'end', label: 'End' }];
function NumberField({ label, value, onChange, min, max, step = 1, unit }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: string }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2)))), [editing, setEditing] = useState(false), canceled = useRef(false);
  useEffect(() => { if (!editing) setDraft(String(Number(value.toFixed(2)))); }, [value, editing]);
  function commit(raw: string) { if (!canceled.current && raw.trim() !== '' && Number.isFinite(Number(raw))) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(raw)))); canceled.current = false; setEditing(false); }
  return <Field label={label}><span className="clip-motion-number"><input aria-label={label} type="number" value={draft} min={min} max={max} step={step} onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value)} onBlur={event => commit(event.currentTarget.value)} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { canceled.current = true; event.currentTarget.blur(); } }}/>{unit ? <small>{unit}</small> : null}</span></Field>;
}
function MotionTimeline({ layer, point, fps, duration, editing, onSelect, onMove }: { layer: ClipMotionLayer; point: ClipMotionPoint; fps: number; duration: number; editing: boolean; onSelect: (point: ClipMotionPoint) => void; onMove: (point: ClipMotionPoint, frame: number) => void }) {
  const anchors = clipMotionAnchors(layer, fps), rail = useRef<HTMLDivElement>(null), drag = useRef<{ point: ClipMotionPoint; x: number; frame: number } | null>(null), total = Math.round(duration * fps);
  return <div className="clip-motion-keyframes" aria-label="Photo motion timeline">
    <div className="clip-motion-point-tabs" role="group" aria-label="Motion points">{POINTS.map(item => <button key={item.id} type="button" aria-pressed={editing && point === item.id} onClick={() => onSelect(item.id)}><i/>{item.label}<small>{(anchors[item.id] / fps).toFixed(2)}s</small></button>)}</div>
    <div ref={rail} className="clip-motion-keyframe-rail">
      <i className="clip-motion-keyframe-span" style={{ left: `${anchors.start / total * 100}%`, width: `${(anchors.end - anchors.start) / total * 100}%` }}><b style={{ width: `${(anchors.arrive - anchors.start) / (anchors.end - anchors.start) * 100}%` }}/><b style={{ width: `${(anchors.end - anchors.leave) / (anchors.end - anchors.start) * 100}%` }}/></i>
      {POINTS.map(item => <button key={item.id} type="button" role="slider" aria-label={`${item.label} motion point`} aria-valuemin={item.id === 'start' ? 0 : anchors[item.id === 'arrive' ? 'start' : item.id === 'leave' ? 'arrive' : 'leave'] + (item.id === 'leave' ? 0 : 1)} aria-valuemax={item.id === 'end' ? total : anchors[item.id === 'start' ? 'arrive' : item.id === 'arrive' ? 'leave' : 'end'] - (item.id === 'arrive' ? 0 : 1)} aria-valuenow={anchors[item.id]} aria-valuetext={`${(anchors[item.id] / fps).toFixed(2)} seconds, frame ${anchors[item.id]}`} data-motion-point={item.id} data-selected={editing && point === item.id} style={{ left: `${anchors[item.id] / total * 100}%`, zIndex: point === item.id ? 3 : item.id === 'leave' ? 2 : 1 }}
        onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { point: item.id, x: event.clientX, frame: anchors[item.id] }; onSelect(item.id); }}
        onPointerMove={event => { const active = drag.current; if (active?.point !== item.id || !rail.current) return; onMove(item.id, active.frame + Math.round((event.clientX - active.x) / rail.current.getBoundingClientRect().width * total)); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); onMove(item.id, event.key === 'Home' ? 0 : event.key === 'End' ? total : anchors[item.id] + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 10 : 1)); }}><i/></button>)}
    </div><div className="clip-motion-keyframe-ruler"><span>0s</span><span>Drag a point · arrows fine-tune</span><span>{duration}s</span></div>
  </div>;
}
function useLocalMediaCleanup(media: LocalMedia | null) { useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]); }

export function ClipMotionLab({ active = true }: { active?: boolean }) {
  const [layers, setLayers] = useState(cloneLayers), [selected, setSelected] = useState<ClipMotionLayer['id']>('photo-1');
  const [photos, setPhotos] = useState<PhotoMedia>({ 'photo-1': null, 'photo-2': null }), [background, setBackground] = useState<LocalMedia | null>(null);
  const [duration, setDuration] = useState(8), [fps, setFps] = useState(30), [aspect, setAspect] = useState<'landscape' | 'portrait'>('landscape');
  const [frame, setFrame] = useState(45), [playing, setPlaying] = useState(false), [loop, setLoop] = useState(true), [rate, setRate] = useState(1);
  const [revision, setRevision] = useState(0);
  const [point, setPoint] = useState<ClipMotionPoint>('arrive'), [editingPose, setEditingPose] = useState(false);
  const [notice, setNotice] = useState(''), [viewWidth, setViewWidth] = useState(0), [videoDuration, setVideoDuration] = useState(0);
  const stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), frameRef = useRef(frame), videoTarget = useRef(0);
  const photoInput = useRef<HTMLInputElement>(null), backgroundInput = useRef<HTMLInputElement>(null);
  const poseDrag = useRef<{ x: number; y: number; pose: ClipMotionPose; layerId: ClipMotionLayer['id'] } | null>(null);
  useLocalMediaCleanup(photos['photo-1']); useLocalMediaCleanup(photos['photo-2']); useLocalMediaCleanup(background);
  const total = Math.round(duration * fps), current = layers.find(layer => layer.id === selected)!, width = aspect === 'landscape' ? 960 : 540, height = aspect === 'landscape' ? 540 : 960;
  useEffect(() => { const node = stage.current; if (!node) return; const observer = new ResizeObserver(entries => setViewWidth(entries[0].contentRect.width)); observer.observe(node); return () => observer.disconnect(); }, []);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    if (!playing || !active) return;
    const anchor = performance.now(), initial = frameRef.current; let raf = 0;
    const tick = (now: number) => {
      let next = initial + Math.floor((now - anchor) / 1000 * fps * rate);
      if (next >= total) { if (loop) next %= total; else { next = total - 1; setPlaying(false); } }
      frameRef.current = next; setFrame(next);
      if (next < total - 1 || loop) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [playing, active, fps, total, rate, loop, revision]);
  function syncVideo() {
    const element = video.current;
    if (!element || !element.readyState || element.seeking) return;
    const target = Math.min(videoTarget.current, Math.max(0, element.duration - 1 / fps));
    if (Math.abs(element.currentTime - target) > .4 / fps) element.currentTime = target;
  }
  useEffect(() => { videoTarget.current = frame / fps; syncVideo(); });
  function seek(value: number) { const next = Math.min(total - 1, Math.max(0, Math.round(value))); setPlaying(false); setEditingPose(false); frameRef.current = next; setFrame(next); }
  function replay() { setEditingPose(false); frameRef.current = 0; setFrame(0); setRevision(value => value + 1); setPlaying(true); }
  function update(patch: Partial<ClipMotionLayer>) { setLayers(previous => previous.map(layer => layer.id === selected ? boundClipMotionLayer({ ...layer, ...patch }, duration, fps) : layer)); }
  function selectPoint(next: ClipMotionPoint) { seek(clipMotionAnchors(current, fps)[next]); setPoint(next); setEditingPose(true); }
  function movePoint(next: ClipMotionPoint, target: number) { const layer = moveClipMotionAnchor(current, next, target, duration, fps); setLayers(previous => previous.map(item => item.id === selected ? layer : item)); seek(clipMotionAnchors(layer, fps)[next]); setPoint(next); setEditingPose(true); }
  function updatePose(patch: Partial<ClipMotionPose>) { if (!editingPose) seek(clipMotionAnchors(current, fps)[point]); setPlaying(false); setEditingPose(true); setLayers(previous => previous.map(layer => layer.id === selected ? updateClipMotionPose(layer, point, patch, width, height) : layer)); }
  function changePreset(side: 'entrance' | 'exit', value: ClipMotionLayer['entrance']) { update({ [side]: value, poses: { ...current.poses, [side === 'entrance' ? 'start' : 'end']: undefined } }); }
  function selectLayer(id: ClipMotionLayer['id']) { setSelected(id); setEditingPose(false); }
  function startPoseDrag(event: ReactPointerEvent<HTMLDivElement>, layer: ClipMotionLayer) {
    if (event.button !== 0 || !layer.enabled) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const nextPoint = editingPose && layer.id === selected ? point : 'arrive';
    const pose = clipMotionPoseAtPoint(layer, nextPoint, width, height);
    setSelected(layer.id); setPoint(nextPoint); seek(clipMotionAnchors(layer, fps)[nextPoint]); setEditingPose(true);
    poseDrag.current = { x: event.clientX, y: event.clientY, pose, layerId: layer.id };
  }
  function dragPose(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = poseDrag.current, bounds = stage.current?.getBoundingClientRect(); if (!drag || !bounds) return;
    updatePose({ x: drag.pose.x + (event.clientX - drag.x) / bounds.width, y: drag.pose.y + (event.clientY - drag.y) / bounds.height });
  }
  function setClock(nextDuration: number, nextFps: number) { setPlaying(false); setEditingPose(false); setLayers(previous => previous.map(layer => boundClipMotionLayer(layer, nextDuration, nextFps))); const next = Math.min(Math.round(frame / fps * nextFps), Math.round(nextDuration * nextFps) - 1); frameRef.current = next; setFrame(next); setDuration(nextDuration); setFps(nextFps); }
  function uploadPhoto(file: File) {
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') { setNotice('Choose a PNG, JPEG, WebP, GIF or AVIF image.'); return; }
    setPhotos(previous => ({ ...previous, [selected]: { name: file.name, url: URL.createObjectURL(file) } })); setNotice('Photo replaced locally. It stays in this browser tab.');
  }
  function uploadVideo(file: File) { if (!file.type.startsWith('video/')) { setNotice('Choose a video your browser can play.'); return; } setPlaying(false); setVideoDuration(0); setBackground({ name: file.name, url: URL.createObjectURL(file) }); setNotice('Local background video added, muted. It follows the same preview frame.'); }
  const selectedMedia = photos[selected];
  const anchors = clipMotionAnchors(current, fps), pose = clipMotionPoseAtPoint(current, point, width, height), pointLabel = POINTS.find(item => item.id === point)!.label;
  return <section className="clip-motion-lab" aria-label="Photo clip animations experiment">
    <div className="clip-motion-grid">
      <div className="clip-motion-preview-column">
        <div className="rmlab-preview-toolbar"><span><i/>Two photo layers</span><span>{width} × {height} · {fps} fps</span></div>
        <div className={`clip-motion-stage-wrap${aspect === 'portrait' ? ' clip-motion-portrait' : ''}`}>
          <div ref={stage} className="clip-motion-stage" style={{ aspectRatio: `${width}/${height}` }}>
            <div className="clip-motion-artboard" data-clip-motion-frame={frame} style={{ width, height, transform: `scale(${viewWidth / width})`, visibility: viewWidth ? 'visible' : 'hidden' }}>
              {background ? <video ref={video} src={background.url} muted playsInline preload="auto" className="clip-motion-background" onLoadedMetadata={event => { setVideoDuration(event.currentTarget.duration); syncVideo(); }} onSeeked={syncVideo} onError={() => { setBackground(null); setNotice('This video could not be decoded. Try an H.264 MP4.'); }}/> : null}
              {layers.map(layer => {
                const motion = clipMotionAt(layer, frame, fps, width, height), editing = editingPose && layer.id === selected && layer.enabled;
                const rendered = editing ? clipMotionPoseAtPoint(layer, point, width, height) : motion;
                return <div key={layer.id} className="clip-motion-position" data-photo-layer={layer.id} data-phase={motion.phase} data-enabled={layer.enabled} data-editing={editing} style={{ left: `${rendered.x * 100}%`, top: `${rendered.y * 100}%`, width: `${layer.width * 100}%`, transform: `translate(-50%,-50%) rotate(${rendered.rotation}deg) scale(${rendered.scale})`, zIndex: editing ? 3 : layer.id === 'photo-2' ? 2 : 1, pointerEvents: editing || motion.visible ? 'auto' : 'none' }}
                  onPointerDown={event => startPoseDrag(event, layer)} onPointerMove={dragPose} onPointerUp={() => { poseDrag.current = null; }} onPointerCancel={() => { poseDrag.current = null; }}>
                  <div className="clip-motion-photo" style={{ aspectRatio: layer.aspect === 'landscape' ? '3/2' : layer.aspect === 'square' ? '1' : '3/4', borderRadius: layer.radius, opacity: rendered.opacity }}><img src={photos[layer.id]?.url ?? DEMO_IMAGE} alt={layer.name} draggable={false} onError={() => { if (photos[layer.id]) { setPhotos(previous => ({ ...previous, [layer.id]: null })); setNotice('This image could not be decoded. Restored the demo photo.'); } }}/></div>
                  {editing ? <div className="clip-motion-pose-outline"><span>{layer.name} · {pointLabel}{rendered.opacity === 0 ? ' · hidden pose' : ''}</span><i/><i/><i/><i/></div> : null}
                </div>;
              })}
            </div>
          </div>
        </div>
        <div className="rmlab-player">
          <div className="rmlab-transport"><div className="rmlab-button-row"><button type="button" className="rmlab-icon-button" aria-label="Replay photo animations" onClick={replay}><RotateCcw size={15}/></button><PrimaryButton type="button" size="icon" className="rmlab-play-button" aria-label={playing ? 'Pause photo animations' : 'Play photo animations'} onClick={() => { setEditingPose(false); if (frame >= total - 1) { frameRef.current = 0; setFrame(0); } setPlaying(value => !value); }}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</PrimaryButton><button type="button" className="rmlab-frame-step" aria-label="Previous photo frame" onClick={() => seek(frame - 1)}>−1</button><button type="button" className="rmlab-frame-step" aria-label="Next photo frame" onClick={() => seek(frame + 1)}>+1</button></div><output className="rmlab-time">{(frame / fps).toFixed(2)}<span> / {duration}s</span></output></div>
          <div className="clip-motion-play-options"><Field label="Playback speed"><select aria-label="Photo playback speed" value={rate} onChange={event => setRate(Number(event.target.value))}><option value={.1}>0.1×</option><option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option></select></Field><label className="rmlab-check"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)}/>Loop</label><span>FRAME {frame}</span></div>
          <div className="clip-motion-timing" aria-label="Two photo layer timing bars"><div className="clip-motion-ruler"><span>0s</span><span>{duration / 2}s</span><span>{duration}s</span></div>{layers.map(layer => <button type="button" key={layer.id} data-timing-layer={layer.id} aria-label={`Select ${layer.name} timing`} aria-pressed={selected === layer.id} onClick={() => { selectLayer(layer.id); seek(Math.round(layer.start * fps)); }}><span>{layer.name}</span><span className="clip-motion-track" style={{ '--clip-playhead': `${frame / (total - 1) * 100}%` } as CSSProperties}><i className="clip-motion-timing-bar" style={{ left: `${layer.start / duration * 100}%`, width: `${(layer.end - layer.start) / duration * 100}%`, opacity: layer.enabled ? 1 : .35 }}><b style={{ width: `${layer.enterDuration / (layer.end - layer.start) * 100}%` }}/><b style={{ width: `${layer.exitDuration / (layer.end - layer.start) * 100}%` }}/></i><i className="clip-motion-timing-playhead"/></span></button>)}</div>
          <input className="rmlab-seek" aria-label="Photo preview frame" type="range" min={0} max={total - 1} value={frame} onChange={event => seek(Number(event.target.value))}/>
          <p className="clip-motion-caption">Tinted ends show entrance / exit. Click a timing row to jump to its start.</p>
        </div>
        <div className="clip-motion-background-tools"><button type="button" className="rmlab-button" onClick={() => backgroundInput.current?.click()}><Upload size={13}/>{background ? 'Replace local video' : 'Add local background video'}</button>{background ? <button type="button" className="rmlab-icon-button" aria-label="Remove local background video" onClick={() => { setBackground(null); setVideoDuration(0); }}><X size={14}/></button> : null}</div>
        {background ? <p className="clip-motion-caption">{background.name} · {videoDuration ? `${videoDuration.toFixed(1)}s` : 'Loading'} · muted{videoDuration && videoDuration < duration ? ' · holds its last frame' : ''}</p> : <p className="clip-motion-caption">Plain white canvas. Add a local video to judge the photos over footage.</p>}
        <input hidden ref={backgroundInput} type="file" aria-label="Local background video file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) uploadVideo(file); event.target.value = ''; }}/>
      </div>
      <aside className="rmlab-inspector clip-motion-controls" aria-label="Photo animation controls">
        <div className="rmlab-inspector-heading"><span>Photo motion</span><button type="button" className="rmlab-icon-button" aria-label="Reset photo animations" onClick={() => { setLayers(cloneLayers()); setClock(8, fps); seek(0); setNotice('Default fade and staggered slide restored. Your local images are kept.'); }}><RotateCcw size={13}/></button></div>
        <div className="clip-motion-layer-picker" role="group" aria-label="Select a photo layer">{layers.map(layer => <button type="button" key={layer.id} aria-pressed={selected === layer.id} onClick={() => selectLayer(layer.id)}><img src={photos[layer.id]?.url ?? DEMO_IMAGE} alt=""/>{layer.name}</button>)}</div>
        <div className="rmlab-controls clip-motion-control-stack">
          <label className="rmlab-check"><input aria-label={`Show ${current.name}`} type="checkbox" checked={current.enabled} onChange={event => update({ enabled: event.target.checked })}/>Show {current.name.toLowerCase()}</label>
          <div className="rmlab-field-pair"><Field label="Entrance"><select aria-label="Photo entrance" value={current.entrance} onChange={event => changePreset('entrance', event.target.value as ClipMotionLayer['entrance'])}>{CLIP_MOTION_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field><Field label="Exit"><select aria-label="Photo exit" value={current.exit} onChange={event => changePreset('exit', event.target.value as ClipMotionLayer['exit'])}>{CLIP_MOTION_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field></div>
          <MotionTimeline layer={current} point={point} fps={fps} duration={duration} editing={editingPose} onSelect={selectPoint} onMove={movePoint}/>
          <div className="clip-motion-pose-heading"><span><Move size={13}/>{point === 'arrive' || point === 'leave' ? 'Hold pose' : `${pointLabel} pose`}</span><button type="button" className="rmlab-button rmlab-button-small" aria-pressed={editingPose} onClick={() => editingPose ? setEditingPose(false) : selectPoint(point)}>{editingPose ? 'View animation' : 'Edit pose'}</button></div>
          <NumberField label={`${pointLabel} time`} value={anchors[point] / fps} min={0} max={duration} step={1 / fps} unit="s" onChange={value => movePoint(point, Math.round(value * fps))}/>
          <div className="clip-motion-pose-fields">
            <NumberField label="Position X" value={pose.x * 100} unit="%" onChange={value => updatePose({ x: value / 100 })}/><NumberField label="Position Y" value={pose.y * 100} unit="%" onChange={value => updatePose({ y: value / 100 })}/>
            <NumberField label="Scale" value={pose.scale * 100} min={1} max={500} unit="%" onChange={value => updatePose({ scale: value / 100 })}/><NumberField label="Rotation" value={pose.rotation} min={-360} max={360} unit="°" onChange={rotation => updatePose({ rotation })}/>
          </div>
          <NumberField label="Opacity" value={pose.opacity * 100} min={0} max={100} unit="%" onChange={value => updatePose({ opacity: value / 100 })}/>
          <p className="clip-motion-caption">{editingPose ? 'Drag the outlined photo to place this pose.' : 'Select a point to edit its pose, then play to see the motion.'} {point === 'arrive' || point === 'leave' ? 'Arrive and Leave share this pose.' : 'An outline lets you place a hidden pose.'}</p>
          <Field label="Easing"><select aria-label="Photo easing" value={current.easing} onChange={event => update({ easing: event.target.value as ClipMotionLayer['easing'] })}><option value="ease-out">Smooth ease out</option><option value="ease-in-out">Smooth ease in / out</option><option value="linear">Linear</option><option value="spring">Spring</option></select></Field>
          <details className="clip-motion-disclosure"><summary>Appearance<ChevronDown size={13}/></summary><div>
            <div className="clip-motion-asset-row"><button type="button" className="rmlab-button" onClick={() => photoInput.current?.click()}><ImagePlus size={14}/>Replace {current.name.toLowerCase()}</button>{selectedMedia ? <button type="button" className="rmlab-icon-button" aria-label={`Restore demo ${current.name.toLowerCase()}`} onClick={() => setPhotos(previous => ({ ...previous, [selected]: null }))}><RotateCcw size={13}/></button> : null}</div>
            <p className="clip-motion-caption" title={selectedMedia?.name}>{selectedMedia?.name ?? 'Demo image'} · local files stay in this tab</p>
            <div className="rmlab-field-pair"><NumberField label="Photo width" value={current.width * 100} min={10} max={90} unit="%" onChange={value => update({ width: value / 100 })}/><NumberField label="Photo corner radius" value={current.radius} min={0} max={40} unit="px" onChange={radius => update({ radius })}/></div>
            <Field label="Photo shape"><select aria-label="Photo shape" value={current.aspect} onChange={event => update({ aspect: event.target.value as ClipMotionLayer['aspect'] })}><option value="landscape">Landscape · 3:2</option><option value="square">Square</option><option value="portrait">Portrait · 3:4</option></select></Field>
          </div></details>
          <input hidden ref={photoInput} type="file" aria-label="Local photo file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={event => { const file = event.target.files?.[0]; if (file) uploadPhoto(file); event.target.value = ''; }}/>
          <details className="clip-motion-disclosure"><summary>Preview settings<ChevronDown size={13}/></summary><div>
            <Field label="Canvas format"><select aria-label="Photo canvas format" value={aspect} onChange={event => setAspect(event.target.value as typeof aspect)}><option value="landscape">Landscape · 16:9</option><option value="portrait">Portrait · 9:16</option></select></Field>
            <div className="rmlab-field-pair"><Field label="Preview length (s)"><input aria-label="Photo preview duration" type="number" min={2} max={20} step={.5} value={duration} onChange={event => setClock(Math.max(2, Math.min(20, Number(event.target.value))), fps)}/></Field><Field label="Frame rate"><select aria-label="Photo frame rate" value={fps} onChange={event => setClock(duration, Number(event.target.value))}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></Field></div>
          </div></details>
        </div>
      </aside>
    </div>
    {notice ? <p className="clip-motion-notice" role="status">{notice}<button type="button" className="rmlab-icon-button" aria-label="Dismiss photo message" onClick={() => setNotice('')}><X size={13}/></button></p> : null}
    <p className="clip-motion-caption clip-motion-local-note">Development preview only. These settings and local files are separate from saved templates.</p>
  </section>;
}
