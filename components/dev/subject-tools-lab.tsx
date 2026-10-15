'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Crosshair, Layers3, Pause, Play, ScanFace, Scissors, SkipBack, SkipForward, Upload } from 'lucide-react';
import { useMediaPlayer } from '@meta-sam/react';
import { decodeMaskToRaster, parseVideoStream, type VideoSegmentationSnapshot } from '@meta-sam/parser';
import type { CustomRenderFunction, IMediaPlayer } from '@meta-sam/video';
import { samEvents } from '@/lib/meta-sam/events';
import { indexSubjectMasks, subjectMasksAt, trackedSubjectAt, type SubjectMaskIndex } from '@/lib/dev/subject-tools';
import type { FocusSample } from '@/lib/editor/tracking';
import { userError } from '@/lib/user-error';
import { ColorControl } from '@/components/editor/color-control';
import { PrimaryButton } from '@/components/workspace/primary-button';
import './subject-tools-lab.css';

type Player = Pick<IMediaPlayer, 'play' | 'pause' | 'seek' | 'previousFrame' | 'nextFrame'>;
type MaskLook = 'behind' | 'cutout' | 'tint' | 'blur' | 'mask' | 'original';
type MaskSettings = { look: MaskLook; objectId: string; text: string; color: string; size: number; textY: number; blur: number };
const emptyMasks = indexSubjectMasks([]);

export function SubjectToolsLab({ mode }: { mode: 'tracking' | 'masking' }) {
  return mode === 'tracking' ? <TrackingLab /> : <MaskingLab />;
}

function Playback({ playing, time, duration, disabled, onToggle, onSeek, onStep }: { playing: boolean; time: number; duration: number; disabled: boolean; onToggle: () => void; onSeek: (time: number) => void; onStep: (direction: number) => void }) {
  return <div className="subject-lab-playback">
    <div className="subject-lab-transport">
      <button type="button" aria-label="Previous frame" disabled={disabled} onClick={() => onStep(-1)}><SkipBack size={13} /></button>
      <button type="button" className="subject-lab-play" aria-label={playing ? 'Pause preview' : 'Play preview'} disabled={disabled} onClick={onToggle}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
      <button type="button" aria-label="Next frame" disabled={disabled} onClick={() => onStep(1)}><SkipForward size={13} /></button>
      <span>{time.toFixed(2)}<i> / {duration.toFixed(2)}s</i></span>
    </div>
    <input aria-label="Preview time" type="range" min={0} max={duration || 1} step={.01} value={Math.min(time, duration || 1)} disabled={disabled} onChange={event => onSeek(Number(event.target.value))} />
  </div>;
}

function FilePicker({ file, disabled, masking, onFile }: { file: File | null; disabled: boolean; masking?: boolean; onFile: (file: File | null) => void }) {
  const id = useId();
  return <div className="subject-lab-upload">
    <input id={id} type="file" accept={masking ? 'video/mp4,video/quicktime' : 'video/*'} disabled={disabled} onChange={event => { onFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
    <label htmlFor={id}><Upload size={14} /><span>{file ? 'Replace video' : 'Choose local video'}</span></label>
    <small>{file ? file.name : masking ? 'MP4 / MOV · up to 10 seconds · 1080p · 20 MB' : 'Video stays in your browser · first 5 minutes'}</small>
  </div>;
}

function Range({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return <label className="subject-lab-range"><span>{label}<output>{value}{unit}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}

function TrackingLab() {
  const [file, setFile] = useState<File | null>(null), [url, setUrl] = useState('');
  const [samples, setSamples] = useState<FocusSample[]>([]), [progress, setProgress] = useState(0), [working, setWorking] = useState(false);
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [playing, setPlaying] = useState(false), [ratio, setRatio] = useState(16 / 9);
  const [label, setLabel] = useState('THE MAIN CHARACTER'), [color, setColor] = useState('#d9fb73'), [size, setSize] = useState(6), [offsetX, setOffsetX] = useState(0), [offsetY, setOffsetY] = useState(-15), [showPoint, setShowPoint] = useState(true), [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null), job = useRef(0);
  useEffect(() => { if (!file) return; const source = URL.createObjectURL(file); setUrl(source); return () => URL.revokeObjectURL(source); }, [file]);
  useEffect(() => () => { job.current++; }, []);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const update = () => { if (video.current) setTime(video.current.currentTime); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update); return () => cancelAnimationFrame(frame);
  }, [playing]);
  const subject = trackedSubjectAt(samples, time);
  function selectFile(selected: File | null) {
    job.current++; setError(''); setSamples([]); setProgress(0); setTime(0); setDuration(0); setPlaying(false); setWorking(false); setUrl('');
    if (selected && !selected.type.startsWith('video/')) { setFile(null); setError('Choose a video your browser can play.'); return; }
    setFile(selected);
  }
  async function track() {
    if (!file || !url || working) return;
    video.current?.pause(); setWorking(true); setError(''); setProgress(0); const current = ++job.current;
    try {
      const { trackFace } = await import('@/lib/editor/tracking');
      const measured = await trackFace({ _id: 'local-tracking-lab', fileName: file.name, kind: 'video', url, duration }, value => { if (job.current === current) setProgress(value); });
      if (job.current === current) { setSamples(measured); if (video.current) video.current.currentTime = measured[0].time; }
    } catch (failure) { if (job.current === current) setError(userError(failure, 'Could not track a face in this video.')); }
    finally { if (job.current === current) setWorking(false); }
  }
  function seek(value: number) { if (video.current) { video.current.pause(); video.current.currentTime = Math.max(0, Math.min(duration, value)); setTime(video.current.currentTime); } }
  return <section className="subject-lab" aria-label="Subject tracking experiment">
    <div className="subject-lab-layout">
      <div className="subject-lab-view">
        <div className="subject-lab-preview" style={{ aspectRatio: ratio, maxWidth: `${420 * ratio}px` }}>
          {url ? <><video ref={video} src={url} muted playsInline preload="metadata" onLoadedMetadata={event => { const element = event.currentTarget; setDuration(element.duration); setRatio(element.videoWidth / element.videoHeight || 16 / 9); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onSeeked={event => setTime(event.currentTarget.currentTime)} onError={() => setError('This video could not be decoded. Try an H.264 MP4.')} />
            {subject ? <><span className="subject-lab-follow-label" style={{ left: `${(subject.x + offsetX / 100) * 100}%`, top: `${(subject.y + offsetY / 100) * 100}%`, color, fontSize: `${size}cqw` }}>{label}</span>{showPoint ? <Crosshair className="subject-lab-track-point" size={25} style={{ left: `${subject.x * 100}%`, top: `${subject.y * 100}%`, color }} /> : null}</> : null}</> : <div className="subject-lab-empty"><ScanFace size={30} /><strong>Make your text follow a face</strong><span>Upload a video, then run local tracking.</span></div>}
        </div>
        <Playback playing={playing} time={time} duration={duration} disabled={!url || !duration || working} onToggle={() => { if (playing) video.current?.pause(); else void video.current?.play().catch(failure => setError(userError(failure, 'Could not play this video.'))); }} onSeek={seek} onStep={direction => seek(time + direction / 30)} />
        <p className="subject-lab-caption">{samples.length ? `${samples.length} measured centers · 0.5s sampling · interpolated motion${duration > 300 ? ' · first 5 minutes only' : ''}` : 'Local MediaPipe face detection. The label appears after a face is detected.'}</p>
      </div>
      <div className="subject-lab-controls">
        <FilePicker file={file} disabled={working} onFile={selectFile} />
        <PrimaryButton type="button" className="subject-lab-primary" disabled={!url || !duration || working} onClick={() => void track()}><ScanFace size={15} />{working ? `Tracking face… ${progress}%` : samples.length ? 'Track face again' : 'Track face locally'}</PrimaryButton>
        {working ? <progress aria-label="Tracking progress" value={progress} max={100} /> : null}
        <p className="subject-lab-note">Free local processing. Follows the largest face first, then the nearest face. Works best with one clear face.</p>
        <label className="subject-lab-field">Following label<input value={label} maxLength={80} onChange={event => setLabel(event.target.value)} /></label>
        <div className="subject-lab-color"><label>Label color<ColorControl label="Label color" value={color} onCommit={setColor} /></label><label className="subject-lab-check"><input type="checkbox" checked={showPoint} onChange={event => setShowPoint(event.target.checked)} />Show target</label></div>
        <Range label="Text size" value={size} min={2} max={12} step={.5} unit="%" onChange={setSize} />
        <Range label="Horizontal offset" value={offsetX} min={-40} max={40} unit="%" onChange={setOffsetX} />
        <Range label="Vertical offset" value={offsetY} min={-40} max={40} unit="%" onChange={setOffsetY} />
        <div className="subject-lab-status" role="status">{working ? 'Measuring face centers in your video…' : samples.length ? subject ? 'Label is following the measured face path.' : 'No measured track at this time. Seek into the tracked range.' : 'Choose a video and click Track face locally to begin.'}</div>
        {error ? <p className="subject-lab-error" role="alert">{error}</p> : null}
      </div>
    </div>
    <p className="subject-lab-footer">Preview experiment · no timeline changes · frame-step buttons use a 30 fps preview step</p>
  </section>;
}

function MaskingLab() {
  const [file, setFile] = useState<File | null>(null), [configured, setConfigured] = useState<boolean | null>(null), [prompt, setPrompt] = useState('person');
  const [result, setResult] = useState<VideoSegmentationSnapshot>(), [working, setWorking] = useState(false), [complete, setComplete] = useState(false), [error, setError] = useState('');
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0), [frameIndex, setFrameIndex] = useState(0), [ratio, setRatio] = useState(16 / 9);
  const [settings, setSettings] = useState<MaskSettings>({ look: 'behind', objectId: 'all', text: 'STAY FOCUSED', color: '#d9fb73', size: 15, textY: 52, blur: 18 });
  const player = useRef<Player | null>(null), request = useRef<AbortController | null>(null);
  const index = useMemo(() => result ? indexSubjectMasks(result.records) : emptyMasks, [result]);
  const currentMasks = subjectMasksAt(index, frameIndex, settings.objectId);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/dev/sam', { signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); const status: unknown = await response.json(); if (!controller.signal.aborted) setConfigured(!!status && typeof status === 'object' && 'configured' in status && status.configured === true); }).catch(() => { if (!controller.signal.aborted) setConfigured(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  function update(changes: Partial<MaskSettings>) { setSettings(previous => ({ ...previous, ...changes })); }
  function selectFile(selected: File | null) {
    request.current?.abort(); request.current = null; player.current = null; setWorking(false); setResult(undefined); setComplete(false); setError(''); setTime(0); setDuration(0); setFrameIndex(0); setPlaying(false); update({ objectId: 'all' });
    if (selected && (!['video/mp4', 'video/quicktime'].includes(selected.type) || !selected.size || selected.size > 20 * 1024 * 1024)) { setFile(null); setError('Choose an MP4 or MOV under 20 MB.'); return; }
    setFile(selected);
  }
  async function segment() {
    if (!file || working || !prompt.trim() || configured !== true) return;
    player.current?.pause(); setWorking(true); setError(''); setResult(undefined); setComplete(false); update({ objectId: 'all' });
    const controller = new AbortController(); request.current = controller;
    try {
      const form = new FormData(); form.append('video', file); form.append('prompt', prompt.trim());
      const response = await fetch('/api/dev/sam', { method: 'POST', body: form, signal: controller.signal });
      if (!response.ok) { const failure: unknown = await response.json().catch(() => null); throw new Error(failure && typeof failure === 'object' && 'error' in failure && typeof failure.error === 'string' ? failure.error : 'Could not find this subject.'); }
      if (!response.body) throw new Error('Meta returned no mask stream.');
      const parsed = parseVideoStream(samEvents(response.body));
      for await (const snapshot of parsed) if (!controller.signal.aborted && request.current === controller) setResult(snapshot);
      const finished = await parsed.finalResult;
      if (controller.signal.aborted || request.current !== controller) return;
      if (!finished || finished.outcome.status !== 'completed') throw new Error('Segmentation ended early. Try a shorter clip.');
      setResult(finished); setComplete(true);
    } catch (failure) { if (!controller.signal.aborted && request.current === controller) setError(userError(failure, 'Could not segment this video.')); }
    finally { if (request.current === controller) { request.current = null; setWorking(false); } }
  }
  function operation(action: (current: Player) => Promise<void> | void) { const current = player.current; if (current) { try { void Promise.resolve(action(current)).catch(failure => setError(userError(failure, 'Could not update playback.'))); } catch (failure) { setError(userError(failure, 'Could not update playback.')); } } }
  return <section className="subject-lab" aria-label="Subject masking experiment">
    <div className="subject-lab-layout">
      <div className="subject-lab-view">
        <div className="subject-lab-preview subject-lab-checker" style={{ aspectRatio: ratio, maxWidth: `${420 * ratio}px` }}>
          {file ? <MaskVideo key={`${file.name}-${file.lastModified}`} file={file} index={index} settings={settings} onReady={current => { player.current = current; }} onMetadata={(length, width, height) => { setDuration(length); setRatio(width / height); }} onTime={setTime} onPlaying={setPlaying} onFrame={setFrameIndex} onError={setError} /> : <div className="subject-lab-empty"><Layers3 size={30} /><strong>Put the subject in front</strong><span>Use a real mask for text, cutouts, and backgrounds.</span></div>}
        </div>
        <Playback playing={playing} time={time} duration={duration} disabled={!file || !duration} onToggle={() => operation(current => playing ? current.pause() : current.play())} onSeek={value => operation(async current => { current.pause(); await current.seek(value); })} onStep={direction => operation(async current => { current.pause(); await (direction < 0 ? current.previousFrame() : current.nextFrame()); })} />
        <p className="subject-lab-caption">{index.count ? `${index.objects.length} subjects · ${index.frames.size} frames with masks · frame ${frameIndex}: ${currentMasks.length} visible masks` : 'Your original video previews immediately. Find subject adds real masks.'}</p>
      </div>
      <div className="subject-lab-controls">
        <FilePicker file={file} disabled={working} masking onFile={selectFile} />
        <label className="subject-lab-field">Subject to find<input value={prompt} maxLength={120} disabled={working} placeholder="person, red bicycle, dog…" onChange={event => setPrompt(event.target.value)} /></label>
        <PrimaryButton type="button" className="subject-lab-primary" disabled={!file || configured !== true || !prompt.trim() || working || !duration || duration > 10.05} onClick={() => void segment()}><Scissors size={15} />{working ? 'Finding subject…' : 'Find subject'}</PrimaryButton>
        <p className="subject-lab-credit">Manual action · uses Meta API credits. Uploading and changing preview settings do not run the model.</p>
        {working ? <button type="button" className="subject-lab-secondary" onClick={() => { request.current?.abort(); request.current = null; setWorking(false); }}>Stop receiving masks</button> : null}
        {duration > 10.05 ? <p className="subject-lab-error">Choose a clip up to 10 seconds long for this experiment.</p> : null}
        {configured === false ? <p className="subject-lab-note">SAM is unavailable. Sign in and configure the server&apos;s Meta connection to run Find subject.</p> : null}
        <label className="subject-lab-field">Preview look<select value={settings.look} onChange={event => update({ look: event.target.value as MaskLook })}><option value="behind">Text behind subject</option><option value="cutout">Subject cutout</option><option value="tint">Tint background</option><option value="blur">Blur background</option><option value="mask">Inspect mask</option><option value="original">Original video</option></select></label>
        {index.objects.length > 1 ? <label className="subject-lab-field">Mask subjects<select value={settings.objectId} onChange={event => update({ objectId: event.target.value })}><option value="all">All detected subjects</option>{index.objects.map(id => <option key={id} value={id}>Subject {id}</option>)}</select></label> : null}
        {settings.look === 'behind' ? <><label className="subject-lab-field">Text behind subject<input value={settings.text} maxLength={80} onChange={event => update({ text: event.target.value })} /></label><Range label="Text size" value={settings.size} min={4} max={25} unit="%" onChange={size => update({ size })} /><Range label="Text height" value={settings.textY} min={10} max={90} unit="%" onChange={textY => update({ textY })} /></> : null}
        {settings.look === 'blur' ? <Range label="Background blur" value={settings.blur} min={2} max={40} unit="px" onChange={blur => update({ blur })} /> : null}
        {['behind', 'tint', 'mask'].includes(settings.look) ? <div className="subject-lab-color"><label>Accent color<ColorControl label="Mask accent color" value={settings.color} onCommit={color => update({ color })} /></label></div> : null}
        <div className="subject-lab-status" role="status">{working ? `${index.frames.size ? `Receiving real masks: ${index.frames.size} frames.` : 'Sending the clip to Meta…'} You can keep previewing.` : complete ? index.count ? 'Real SAM masks ready. Compare looks and scrub the video.' : 'No matching subject found. Try a clearer noun phrase.' : configured === null ? 'Checking Meta connection…' : 'Find subject runs only when you click the button.'}</div>
        {error ? <p className="subject-lab-error" role="alert">{error}</p> : null}
      </div>
    </div>
    <p className="subject-lab-footer">Preview experiment · no timeline changes · frames without a returned mask show original footage</p>
  </section>;
}

function MaskVideo({ file, index, settings, onReady, onMetadata, onTime, onPlaying, onFrame, onError }: { file: File; index: SubjectMaskIndex; settings: MaskSettings; onReady: (player: Player) => void; onMetadata: (duration: number, width: number, height: number) => void; onTime: (time: number) => void; onPlaying: (playing: boolean) => void; onFrame: (index: number) => void; onError: (error: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null), surfaces = useRef<{ alpha: HTMLCanvasElement; foreground: HTMLCanvasElement; masks: Map<string, HTMLCanvasElement> } | null>(null);
  useEffect(() => { surfaces.current = null; }, [file]);
  const renderFrame = useCallback<CustomRenderFunction>(composition => {
    if (composition.signal.aborted) return;
    const { ctx, canvas: target, frame, frameIndex, fallbackCtx, fallbackCanvas } = composition;
    const width = frame.width, height = frame.height, scale = Math.min(target.width / width, target.height / height), x = (target.width - width * scale) / 2, y = (target.height - height * scale) / 2;
    ctx.clearRect(0, 0, target.width, target.height);
    fallbackCtx.clearRect(0, 0, fallbackCanvas.width, fallbackCanvas.height); fallbackCtx.drawImage(frame, x, y, width * scale, height * scale);
    const masks = subjectMasksAt(index, frameIndex, settings.objectId);
    if (!masks.length || settings.look === 'original') { ctx.drawImage(frame, x, y, width * scale, height * scale); return; }
    const retained = surfaces.current ??= { alpha: document.createElement('canvas'), foreground: document.createElement('canvas'), masks: new Map() };
    if (retained.alpha.width !== width || retained.alpha.height !== height) { retained.alpha.width = retained.foreground.width = width; retained.alpha.height = retained.foreground.height = height; }
    const alpha = retained.alpha.getContext('2d')!, foreground = retained.foreground.getContext('2d')!;
    alpha.clearRect(0, 0, width, height);
    for (const record of masks) {
      const key = `${record.identity}:${record.revision}`;
      let raster = retained.masks.get(key);
      if (!raster) {
        raster = document.createElement('canvas'); raster.width = record.mask.width; raster.height = record.mask.height;
        const context = raster.getContext('2d')!, data = context.createImageData(raster.width, raster.height), decoded = decodeMaskToRaster(record.mask);
        for (let pixel = 0; pixel < decoded.length; pixel++) { data.data[pixel * 4] = data.data[pixel * 4 + 1] = data.data[pixel * 4 + 2] = 255; data.data[pixel * 4 + 3] = decoded[pixel] ? 255 : 0; }
        context.putImageData(data, 0, 0); retained.masks.set(key, raster);
        if (retained.masks.size > 32) retained.masks.delete(retained.masks.keys().next().value!);
      }
      alpha.drawImage(raster, record.bounds.left, record.bounds.top, record.bounds.right - record.bounds.left, record.bounds.bottom - record.bounds.top);
    }
    foreground.clearRect(0, 0, width, height); foreground.drawImage(frame, 0, 0, width, height); foreground.globalCompositeOperation = 'destination-in'; foreground.drawImage(retained.alpha, 0, 0); foreground.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    if (settings.look !== 'cutout') {
      if (settings.look === 'blur') ctx.filter = `blur(${settings.blur}px)`;
      ctx.drawImage(frame, 0, 0, width, height); ctx.filter = 'none';
      if (settings.look === 'tint') { ctx.globalAlpha = .62; ctx.fillStyle = settings.color; ctx.fillRect(0, 0, width, height); ctx.globalAlpha = 1; }
      if (settings.look === 'behind') { ctx.fillStyle = settings.color; ctx.font = `900 ${width * settings.size / 100}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(settings.text, width / 2, height * settings.textY / 100, width * .94); }
    }
    if (settings.look === 'mask') { foreground.clearRect(0, 0, width, height); foreground.fillStyle = settings.color; foreground.fillRect(0, 0, width, height); foreground.globalCompositeOperation = 'destination-in'; foreground.drawImage(retained.alpha, 0, 0); foreground.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .65; }
    ctx.drawImage(retained.foreground, 0, 0); ctx.restore();
  }, [index, settings]);
  const player = useMediaPlayer({ canvasRef: canvas, src: file, muted: true, renderFrame, onPlayerReady: onReady, onLoadedMetadata: metadata => onMetadata(metadata.duration, metadata.width, metadata.height), onTimeChange: onTime, onPlayingChange: onPlaying, onFrame: frame => onFrame(frame.frameIndex), onError: error => onError(error.message) });
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const resize = () => { const ratio = Math.min(window.devicePixelRatio || 1, 2), width = Math.round(element.clientWidth * ratio), height = Math.round(element.clientHeight * ratio); if (width && height && (element.width !== width || element.height !== height)) { element.width = width; element.height = height; void player.current?.forceRender().catch(() => {}); } };
    const observer = new ResizeObserver(resize); observer.observe(element); resize(); return () => observer.disconnect();
  }, [player]);
  return <canvas ref={canvas} className="subject-lab-mask-canvas" width={640} height={360} aria-label="Real subject mask composition" />;
}
