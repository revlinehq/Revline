'use client';
import { userError } from '@/lib/user-error';

import { useEffect, useState } from 'react';
import type { Clip } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import './caption-controls.css';

export type CaptionActions = { fps: number; count: number; onTiming: (changes: { start?: number; end?: number }) => void; onApplyStyle: () => void };

export function CaptionTimingControls({ clip, actions }: { clip: Clip; actions: CaptionActions }) {
  const [error, setError] = useState('');
  useEffect(() => setError(''), [clip.id]);
  function change(changes: { start?: number; end?: number }) {
    try { actions.onTiming(changes); setError(''); }
    catch (failure) { setError(userError(failure, 'Could not change this caption’s timing.')); }
  }
  return <fieldset className="caption-timing-controls"><legend>Timing</legend><div>
    <NumberControl label="Caption start" value={clip.start} min={0} max={Number.MAX_SAFE_INTEGER} step={1 / actions.fps} unit="s" onCommit={start => change({ start })}/>
    <NumberControl label="Caption end" value={clip.start + clip.duration} min={0} max={Number.MAX_SAFE_INTEGER} step={1 / actions.fps} unit="s" onCommit={end => change({ end })}/>
  </div>{error && <p className="caption-control-error" role="alert">{error}</p>}</fieldset>;
}

export function ApplyCaptionStyle({ actions }: { actions: CaptionActions }) {
  const [result, setResult] = useState('');
  const [failed, setFailed] = useState(false);
  return <div className="caption-style-action"><button type="button" aria-label="Apply style to all captions" disabled={actions.count < 2} onClick={() => {
    try { actions.onApplyStyle(); setFailed(false); setResult(`Style applied to ${actions.count} captions.`); }
    catch (failure) { setFailed(true); setResult(userError(failure, 'Could not apply this caption style.')); }
  }}>Apply style to all captions<span>{actions.count}</span></button>{result && <p role={failed ? 'alert' : 'status'} className={failed ? 'caption-control-error' : undefined}>{result}</p>}</div>;
}
