'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Crosshair, Pause, Play, ScanFace, SkipBack, SkipForward, Upload } from 'lucide-react';
import { trackedSubjectAt } from '@/lib/dev/subject-tools';
import type { FocusSample } from '@/lib/editor/tracking';
import { userError } from '@/lib/user-error';
import { ColorControl } from '@/components/editor/color-control';
import { PrimaryButton } from '@/components/workspace/primary-button';
import './subject-tools-lab.css';

export function SubjectToolsLab() { return <TrackingLab />; }

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

function FilePicker({ file, disabled, onFile }: { file: File | null; disabled: boolean; onFile: (file: File | null) => void }) {
  const id = useId();
  return <div className="subject-lab-upload">
    <input id={id} type="file" accept="video/*" disabled={disabled} onChange={event => { onFile(event.target.files?.[0] ?? null); event.target.value = ''; }} />
    <label htmlFor={id}><Upload size={14} /><span>{file ? 'Replace video' : 'Choose local video'}</span></label>
    <small>{file ? file.name : 'Video stays in your browser · first 5 minutes'}</small>
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
