'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ImagePlus, Pause, Play, RotateCcw, Upload, X } from 'lucide-react';
import { PrimaryButton } from '@/components/workspace/primary-button';
import { boundClipMotionLayer, clipMotionAt, CLIP_MOTION_PRESETS, DEFAULT_CLIP_MOTION_LAYERS, type ClipMotionLayer } from './clip-motion-model';
import './clip-motion-lab.css';

const DEMO_IMAGE = '/images/editor-demo-poster.webp';
type LocalMedia = { name: string; url: string };
type PhotoMedia = Record<ClipMotionLayer['id'], LocalMedia | null>;
const cloneLayers = () => DEFAULT_CLIP_MOTION_LAYERS.map(layer => ({ ...layer }));
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="rmlab-field"><span>{label}</span>{children}</label>; }
function Slider({ label, value, min, max, step = 1, suffix = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="rmlab-range-field"><span>{label}<output>{Number(value.toFixed(2))}{suffix}</output></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))}/></label>;
}
function useLocalMediaCleanup(media: LocalMedia | null) { useEffect(() => () => { if (media) URL.revokeObjectURL(media.url); }, [media]); }

export function ClipMotionLab({ active = true }: { active?: boolean }) {
  const [layers, setLayers] = useState(cloneLayers), [selected, setSelected] = useState<ClipMotionLayer['id']>('photo-1');
  const [photos, setPhotos] = useState<PhotoMedia>({ 'photo-1': null, 'photo-2': null }), [background, setBackground] = useState<LocalMedia | null>(null);
  const [duration, setDuration] = useState(8), [fps, setFps] = useState(30), [aspect, setAspect] = useState<'landscape' | 'portrait'>('landscape');
  const [frame, setFrame] = useState(45), [playing, setPlaying] = useState(false), [loop, setLoop] = useState(true), [rate, setRate] = useState(1);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(''), [viewWidth, setViewWidth] = useState(0), [videoDuration, setVideoDuration] = useState(0);
  const stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), frameRef = useRef(frame), videoTarget = useRef(0);
  const photoInput = useRef<HTMLInputElement>(null), backgroundInput = useRef<HTMLInputElement>(null);
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
  function seek(value: number) { const next = Math.min(total - 1, Math.max(0, Math.round(value))); setPlaying(false); frameRef.current = next; setFrame(next); }
  function replay() { frameRef.current = 0; setFrame(0); setRevision(value => value + 1); setPlaying(true); }
  function update(patch: Partial<ClipMotionLayer>) { setLayers(previous => previous.map(layer => layer.id === selected ? boundClipMotionLayer({ ...layer, ...patch }, duration) : layer)); }
  function setClock(nextDuration: number, nextFps: number) { setPlaying(false); setLayers(previous => previous.map(layer => boundClipMotionLayer(layer, nextDuration))); const next = Math.min(Math.round(frame / fps * nextFps), Math.round(nextDuration * nextFps) - 1); frameRef.current = next; setFrame(next); setDuration(nextDuration); setFps(nextFps); }
  function uploadPhoto(file: File) {
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') { setNotice('Choose a PNG, JPEG, WebP, GIF or AVIF image.'); return; }
    setPhotos(previous => ({ ...previous, [selected]: { name: file.name, url: URL.createObjectURL(file) } })); setNotice('Photo replaced locally. It stays in this browser tab.');
  }
  function uploadVideo(file: File) { if (!file.type.startsWith('video/')) { setNotice('Choose a video your browser can play.'); return; } setPlaying(false); setVideoDuration(0); setBackground({ name: file.name, url: URL.createObjectURL(file) }); setNotice('Local background video added, muted. It follows the same preview frame.'); }
  const selectedMedia = photos[selected];
  return <section className="clip-motion-lab" aria-label="Photo clip animations experiment">
    <div className="clip-motion-grid">
      <div className="clip-motion-preview-column">
        <div className="rmlab-preview-toolbar"><span><i/>Two photo layers</span><span>{width} × {height} · {fps} fps</span></div>
        <div className={`clip-motion-stage-wrap${aspect === 'portrait' ? ' clip-motion-portrait' : ''}`}>
          <div ref={stage} className="clip-motion-stage" style={{ aspectRatio: `${width}/${height}` }}>
            <div className="clip-motion-artboard" data-clip-motion-frame={frame} style={{ width, height, transform: `scale(${viewWidth / width})`, visibility: viewWidth ? 'visible' : 'hidden' }}>
              {background ? <video ref={video} src={background.url} muted playsInline preload="auto" className="clip-motion-background" onLoadedMetadata={event => { setVideoDuration(event.currentTarget.duration); syncVideo(); }} onSeeked={syncVideo} onError={() => { setBackground(null); setNotice('This video could not be decoded. Try an H.264 MP4.'); }}/> : null}
              {layers.map(layer => { const motion = clipMotionAt(layer, frame, fps); return <div key={layer.id} className="clip-motion-position" data-photo-layer={layer.id} data-phase={motion.phase} data-enabled={layer.enabled} style={{ left: `${layer.x * 100}%`, top: `${layer.y * 100}%`, width: `${layer.width * 100}%`, transform: `translate(-50%,-50%) rotate(${layer.rotation}deg)`, zIndex: layer.id === 'photo-2' ? 2 : 1 }}>
                <div className="clip-motion-photo" style={{ aspectRatio: layer.aspect === 'landscape' ? '3/2' : layer.aspect === 'square' ? '1' : '3/4', borderRadius: layer.radius, opacity: motion.opacity, transform: `translate3d(${motion.x}px,${motion.y}px,0) scale(${motion.scale})` }}><img src={photos[layer.id]?.url ?? DEMO_IMAGE} alt={layer.name} draggable={false} onError={() => { if (photos[layer.id]) { setPhotos(previous => ({ ...previous, [layer.id]: null })); setNotice('This image could not be decoded. Restored the demo photo.'); } }}/></div>
              </div>; })}
            </div>
          </div>
        </div>
        <div className="rmlab-player">
          <div className="rmlab-transport"><div className="rmlab-button-row"><button type="button" className="rmlab-icon-button" aria-label="Replay photo animations" onClick={replay}><RotateCcw size={15}/></button><PrimaryButton type="button" size="icon" className="rmlab-play-button" aria-label={playing ? 'Pause photo animations' : 'Play photo animations'} onClick={() => { if (frame >= total - 1) { frameRef.current = 0; setFrame(0); } setPlaying(value => !value); }}>{playing ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}</PrimaryButton><button type="button" className="rmlab-frame-step" aria-label="Previous photo frame" onClick={() => seek(frame - 1)}>−1</button><button type="button" className="rmlab-frame-step" aria-label="Next photo frame" onClick={() => seek(frame + 1)}>+1</button></div><output className="rmlab-time">{(frame / fps).toFixed(2)}<span> / {duration}s</span></output></div>
          <div className="clip-motion-play-options"><Field label="Playback speed"><select aria-label="Photo playback speed" value={rate} onChange={event => setRate(Number(event.target.value))}><option value={.1}>0.1×</option><option value={.25}>0.25×</option><option value={.5}>0.5×</option><option value={1}>1×</option></select></Field><label className="rmlab-check"><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)}/>Loop</label><span>FRAME {frame}</span></div>
          <div className="clip-motion-timing" aria-label="Two photo layer timing bars"><div className="clip-motion-ruler"><span>0s</span><span>{duration / 2}s</span><span>{duration}s</span></div>{layers.map(layer => <button type="button" key={layer.id} data-timing-layer={layer.id} aria-label={`Select ${layer.name} timing`} aria-pressed={selected === layer.id} onClick={() => { setSelected(layer.id); seek(Math.round(layer.start * fps)); }}><span>{layer.name}</span><span className="clip-motion-track" style={{ '--clip-playhead': `${frame / (total - 1) * 100}%` } as CSSProperties}><i className="clip-motion-timing-bar" style={{ left: `${layer.start / duration * 100}%`, width: `${(layer.end - layer.start) / duration * 100}%`, opacity: layer.enabled ? 1 : .35 }}><b style={{ width: `${layer.enterDuration / (layer.end - layer.start) * 100}%` }}/><b style={{ width: `${layer.exitDuration / (layer.end - layer.start) * 100}%` }}/></i><i className="clip-motion-timing-playhead"/></span></button>)}</div>
          <input className="rmlab-seek" aria-label="Photo preview frame" type="range" min={0} max={total - 1} value={frame} onChange={event => seek(Number(event.target.value))}/>
          <p className="clip-motion-caption">Tinted ends show entrance / exit. Click a timing row to jump to its start.</p>
        </div>
        <div className="clip-motion-background-tools"><button type="button" className="rmlab-button" onClick={() => backgroundInput.current?.click()}><Upload size={13}/>{background ? 'Replace local video' : 'Add local background video'}</button>{background ? <button type="button" className="rmlab-icon-button" aria-label="Remove local background video" onClick={() => { setBackground(null); setVideoDuration(0); }}><X size={14}/></button> : null}</div>
        {background ? <p className="clip-motion-caption">{background.name} · {videoDuration ? `${videoDuration.toFixed(1)}s` : 'Loading'} · muted{videoDuration && videoDuration < duration ? ' · holds its last frame' : ''}</p> : <p className="clip-motion-caption">Plain white canvas. Add a local video to judge the photos over footage.</p>}
        <input hidden ref={backgroundInput} type="file" aria-label="Local background video file" accept="video/*" onChange={event => { const file = event.target.files?.[0]; if (file) uploadVideo(file); event.target.value = ''; }}/>
      </div>
      <aside className="rmlab-inspector clip-motion-controls" aria-label="Photo animation controls">
        <div className="rmlab-inspector-heading"><span>Photo animation presets</span><button type="button" className="rmlab-icon-button" aria-label="Reset photo animations" onClick={() => { setLayers(cloneLayers()); setClock(8, fps); seek(0); setNotice('Default fade and staggered slide restored. Your local images are kept.'); }}><RotateCcw size={13}/></button></div>
        <div className="clip-motion-layer-picker" role="group" aria-label="Select a photo layer">{layers.map(layer => <button type="button" key={layer.id} aria-pressed={selected === layer.id} onClick={() => setSelected(layer.id)}><img src={photos[layer.id]?.url ?? DEMO_IMAGE} alt=""/>{layer.name}</button>)}</div>
        <div className="rmlab-controls clip-motion-control-stack">
          <div className="clip-motion-asset-row"><button type="button" className="rmlab-button" onClick={() => photoInput.current?.click()}><ImagePlus size={14}/>Replace {current.name.toLowerCase()}</button>{selectedMedia ? <button type="button" className="rmlab-icon-button" aria-label={`Restore demo ${current.name.toLowerCase()}`} onClick={() => setPhotos(previous => ({ ...previous, [selected]: null }))}><RotateCcw size={13}/></button> : null}</div>
          <p className="clip-motion-caption" title={selectedMedia?.name}>{selectedMedia?.name ?? 'Demo image'} · local files stay in this tab</p>
          <input hidden ref={photoInput} type="file" aria-label="Local photo file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={event => { const file = event.target.files?.[0]; if (file) uploadPhoto(file); event.target.value = ''; }}/>
          <label className="rmlab-check"><input aria-label={`Show ${current.name}`} type="checkbox" checked={current.enabled} onChange={event => update({ enabled: event.target.checked })}/>Show {current.name.toLowerCase()}</label>
          <div className="rmlab-field-pair"><Field label="Entrance"><select aria-label="Photo entrance" value={current.entrance} onChange={event => update({ entrance: event.target.value as ClipMotionLayer['entrance'] })}>{CLIP_MOTION_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field><Field label="Exit"><select aria-label="Photo exit" value={current.exit} onChange={event => update({ exit: event.target.value as ClipMotionLayer['exit'] })}>{CLIP_MOTION_PRESETS.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></Field></div>
          <div className="rmlab-field-pair"><Field label="Delay / starts at (s)"><input aria-label="Photo delay" type="number" step={.05} min={0} max={duration - .2} value={Number(current.start.toFixed(2))} onChange={event => update({ start: Number(event.target.value) })}/></Field><Field label="Ends at (s)"><input aria-label="Photo end" type="number" step={.05} min={current.start + .2} max={duration} value={Number(current.end.toFixed(2))} onChange={event => update({ end: Number(event.target.value) })}/></Field></div>
          <Slider label="Entrance duration" value={current.enterDuration} min={.05} max={Math.min(3, (current.end - current.start) / 2)} step={.05} suffix="s" onChange={enterDuration => update({ enterDuration })}/>
          <Slider label="Exit duration" value={current.exitDuration} min={.05} max={Math.min(3, (current.end - current.start) / 2)} step={.05} suffix="s" onChange={exitDuration => update({ exitDuration })}/>
          <Slider label="Travel distance" value={current.distance} min={0} max={400} step={5} suffix="px" onChange={distance => update({ distance })}/>
          <Field label="Easing"><select aria-label="Photo easing" value={current.easing} onChange={event => update({ easing: event.target.value as ClipMotionLayer['easing'] })}><option value="ease-out">Smooth ease out</option><option value="ease-in-out">Smooth ease in / out</option><option value="linear">Linear</option><option value="spring">Spring</option></select></Field>
          <div className="rmlab-control-divider"><span>PLACEMENT</span></div>
          <Slider label="Photo position X" value={Math.round(current.x * 100)} min={5} max={95} suffix="%" onChange={value => update({ x: value / 100 })}/><Slider label="Photo position Y" value={Math.round(current.y * 100)} min={5} max={95} suffix="%" onChange={value => update({ y: value / 100 })}/><Slider label="Photo width" value={Math.round(current.width * 100)} min={10} max={90} suffix="%" onChange={value => update({ width: value / 100 })}/>
          <Field label="Photo shape"><select aria-label="Photo shape" value={current.aspect} onChange={event => update({ aspect: event.target.value as ClipMotionLayer['aspect'] })}><option value="landscape">Landscape · 3:2</option><option value="square">Square</option><option value="portrait">Portrait · 3:4</option></select></Field>
          <Slider label="Photo rotation" value={current.rotation} min={-30} max={30} suffix="°" onChange={rotation => update({ rotation })}/><Slider label="Photo corner radius" value={current.radius} min={0} max={40} suffix="px" onChange={radius => update({ radius })}/>
          <div className="rmlab-control-divider"><span>PREVIEW</span></div>
          <Field label="Canvas format"><select aria-label="Photo canvas format" value={aspect} onChange={event => setAspect(event.target.value as typeof aspect)}><option value="landscape">Landscape · 16:9</option><option value="portrait">Portrait · 9:16</option></select></Field>
          <div className="rmlab-field-pair"><Field label="Preview length (s)"><input aria-label="Photo preview duration" type="number" min={2} max={20} step={.5} value={duration} onChange={event => setClock(Math.max(2, Math.min(20, Number(event.target.value))), fps)}/></Field><Field label="Frame rate"><select aria-label="Photo frame rate" value={fps} onChange={event => setClock(duration, Number(event.target.value))}><option value={24}>24 fps</option><option value={30}>30 fps</option><option value={60}>60 fps</option></select></Field></div>
        </div>
      </aside>
    </div>
    {notice ? <p className="clip-motion-notice" role="status">{notice}<button type="button" className="rmlab-icon-button" aria-label="Dismiss photo message" onClick={() => setNotice('')}><X size={13}/></button></p> : null}
    <p className="clip-motion-caption clip-motion-local-note">Development preview only. These settings and local files are separate from saved templates.</p>
  </section>;
}
