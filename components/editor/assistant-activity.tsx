'use client';

import { useEffect, useMemo, useState } from 'react';
import { AudioLines, Check, CircleAlert, CircleStop, Clock3, Film, LoaderCircle } from 'lucide-react';
import { decodeWaveform, waveformBars } from '@/lib/editor/audio-waveform';
import type { MediaAsset } from '@/lib/editor/types';
import type { ProcessingState } from './processing-status';
import './assistant-activity.css';

function Elapsed({ startedAt }: { startedAt?: number | null }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = startedAt ?? Date.now();
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <small className="assistant-activity-elapsed" aria-hidden="true">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</small>;
}

function ListeningWaveform({ asset }: { asset?: MediaAsset }) {
  const waveform = asset?.waveform;
  const bars = useMemo(() => {
    if (!waveform?.peaks) return null;
    try {
      const data = decodeWaveform(waveform);
      return waveformBars(data, 0, data.samples.length / data.samplesPerSecond, 96, 0, 96);
    } catch { return null; }
  }, [waveform]);
  return <div className="assistant-listening-waveform" data-waveform={bars?.length ? 'source' : 'indicator'} aria-hidden="true">
    {bars?.length ? bars.map(bar => <i key={bar.left} style={{ height: `${Math.max(2, bar.amplitude * 30)}px` }}/>) : <AudioLines size={44} strokeWidth={1.25}/>}
  </div>;
}

export function AssistantActivity({ label, detail, state = 'working', startedAt, asset, className = '' }: {
  label: string; detail?: string | null; state?: ProcessingState; startedAt?: number | null; asset?: MediaAsset; className?: string;
}) {
  const phase = state !== 'working' ? state
    : /^Queued/i.test(label) ? 'queued'
    : /^(Listening|Finding the rhythm)/i.test(label) ? 'listening'
    : /^(Watching|Analyzing footage|Inspecting the moment|Finding shot changes)/i.test(label) ? 'watching'
    : /^Applying edits/i.test(label) ? 'applying' : 'working';
  const title = phase === 'watching' ? 'Watching footage' : phase === 'listening' ? 'Listening to audio' : phase === 'queued' ? 'Queued' : label;
  const Icon = phase === 'watching' ? Film : phase === 'listening' ? AudioLines : phase === 'queued' ? Clock3 : state === 'ready' ? Check : state === 'stopped' ? CircleStop : state === 'error' ? CircleAlert : LoaderCircle;
  const media = phase === 'watching' || phase === 'listening';
  const fileName = asset?.fileName || (media ? detail : undefined);
  const secondary = media ? (detail && detail !== fileName ? detail : undefined) : detail;
  return <div className={`assistant-activity processing-status ${className}`} data-state={state} data-phase={phase} role={state === 'error' ? 'alert' : 'status'}>
    <div className="assistant-activity-heading">
      <span className="assistant-activity-symbol" aria-hidden="true"><Icon size={15} strokeWidth={1.6}/></span>
      <span className="processing-status-label">{title}</span>
      {state === 'working' && <Elapsed key={phase} startedAt={startedAt}/>}
    </div>
    {media ? <div className="assistant-activity-media">
      {phase === 'listening' ? <ListeningWaveform asset={asset}/> : <div className="assistant-watching-thumbnail">{asset?.thumbnailUrl ? <img src={asset.thumbnailUrl} alt="" width={92} height={64} decoding="async" draggable={false}/> : <Film size={24} strokeWidth={1.25}/>}</div>}
      <div className="assistant-activity-media-copy">
        {fileName && <span className="assistant-activity-filename" title={fileName}>{fileName}</span>}
        <span className="processing-status-detail">{secondary || label}</span>
      </div>
    </div> : secondary ? <span className="processing-status-detail">{secondary}</span> : null}
  </div>;
}
