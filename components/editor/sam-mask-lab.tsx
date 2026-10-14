'use client';

import { useEffect, useRef, useState } from 'react';
import { Video, type VideoRef } from '@meta-sam/react';
import { parseVideoStream, type VideoSegmentationSnapshot } from '@meta-sam/parser';
import { samEvents } from '@/lib/meta-sam/events';
import { PrimaryButton } from '@/components/workspace/primary-button';
import './sam-mask-lab.css';

export function SamMaskLab() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState('person');
  const [result, setResult] = useState<VideoSegmentationSnapshot>();
  const [working, setWorking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showMasks, setShowMasks] = useState(true);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const player = useRef<VideoRef>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/dev/sam', { signal: controller.signal }).then(response => response.json()).then(status => setConfigured(!!status && typeof status === 'object' && 'configured' in status && status.configured === true)).catch(() => { if (!controller.signal.aborted) setConfigured(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, []);
  const masks = result?.records.filter(record => record.kind === 'mask') ?? [];
  const objects = new Set(masks.map(record => record.objectId)).size;
  const frames = new Set(masks.map(record => record.frame?.frameIndex)).size;
  async function segment() {
    if (!file || working) return;
    player.current?.pause(); setError(''); setResult(undefined); setComplete(false); setWorking(true);
    const controller = new AbortController(); request.current = controller;
    try {
      const form = new FormData(); form.append('video', file); form.append('prompt', prompt);
      const response = await fetch('/api/dev/sam', { method: 'POST', body: form, signal: controller.signal });
      if (!response.ok) { const failure = await response.json(); throw new Error(failure && typeof failure === 'object' && 'error' in failure && typeof failure.error === 'string' ? failure.error : 'Could not segment this video.'); }
      if (!response.body) throw new Error('Meta returned no mask stream.');
      const parsed = parseVideoStream(samEvents(response.body));
      for await (const snapshot of parsed) { if (!controller.signal.aborted) setResult(snapshot); }
      const finished = await parsed.finalResult;
      if (controller.signal.aborted || request.current !== controller) return;
      if (!finished || finished.outcome.status !== 'completed') throw new Error('Segmentation ended early. Try again with a shorter clip.');
      setResult(finished); setComplete(true);
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not segment this video.'); }
    finally { if (request.current === controller) { request.current = null; setWorking(false); } }
  }
  function selectFile(selected: File | null) {
    request.current?.abort(); request.current = null; setWorking(false); setError(''); setComplete(false); setResult(undefined); setTime(0);
    if (selected && (selected.size > 20 * 1024 * 1024 || !['video/mp4', 'video/quicktime'].includes(selected.type))) { setError('Choose an MP4 or MOV under 20 MB.'); setFile(null); return; }
    setFile(selected);
  }
  return <main className="sam-mask-lab">
    <header><a href="/projects">Revline</a><span>Development · SAM 3.1</span></header>
    <h1>Mask lab</h1><p>Name a subject. See how the mask follows it.</p>
    {configured === false && <aside>Add <code>META_MODEL_API_KEY</code> to <code>.env.local</code> to connect Meta. Your key stays on the server.</aside>}
    <div className="sam-lab-layout">
      <section className="sam-lab-preview" aria-label="Mask preview">
        {file ? <Video key={`${file.name}-${file.lastModified}`} ref={player} src={file} result={showMasks ? result : undefined} muted objectFit="contain" onDurationChange={setDuration} onTimeChange={setTime} onPlayingChange={setPlaying} onError={failure => setError(failure.message)} style={{ width: '100%', height: '100%' }}/> : <span>Choose a short video to begin</span>}
      </section>
      <section className="sam-lab-settings">
        <label>Video<input type="file" accept="video/mp4,video/quicktime" disabled={working} onChange={event => selectFile(event.target.files?.[0] ?? null)}/></label>
        <small>Up to 10 seconds · 600 frames · 1080p · 20 MB</small>
        <label>Subject<input value={prompt} maxLength={120} disabled={working} onChange={event => setPrompt(event.target.value)} placeholder="person, red bicycle, dog…"/></label>
        <PrimaryButton onClick={() => void segment()} disabled={!configured || !file || !prompt.trim() || working}>{working ? 'Finding masks…' : 'Find masks'}</PrimaryButton>
        {working && <button onClick={() => { request.current?.abort(); setWorking(false); }}>Cancel</button>}
        <div className="sam-lab-status" role="status">{working ? <><i aria-hidden="true"/> {frames ? `Received masks for ${frames} frames` : 'Sending your clip to Meta…'}</> : complete ? objects ? `${objects} tracked subjects · ${frames} frames with masks` : 'No matching subjects found. Try another noun phrase.' : 'Masks appear here as Meta processes the clip.'}</div>
        {!!result?.diagnostics.length && <small>{result.diagnostics.length} mask records need attention.</small>}
        {error && <p className="sam-lab-error" role="alert">{error}</p>}
        <label className="sam-lab-toggle"><input type="checkbox" checked={showMasks} onChange={event => setShowMasks(event.target.checked)}/>Show masks</label>
      </section>
    </div>
    {file && <div className="sam-lab-playback"><button onClick={() => void player.current?.previousFrame().catch(failure => setError(failure.message))}>Previous frame</button><PrimaryButton onClick={() => playing ? player.current?.pause() : void player.current?.play().catch(failure => setError(failure.message))}>{playing ? 'Pause' : 'Play'}</PrimaryButton><button onClick={() => void player.current?.nextFrame().catch(failure => setError(failure.message))}>Next frame</button><span>{time.toFixed(2)} / {duration.toFixed(2)}s</span></div>}
    <footer>This experiment previews masks. It doesn’t change your timeline or export a cutout.</footer>
  </main>;
}
