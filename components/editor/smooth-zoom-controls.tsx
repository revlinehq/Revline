'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { smoothZoomPatch } from '@/lib/editor/smooth-zoom';
import { SMOOTH_ZOOM_EASINGS, type SmoothZoomSettings } from '@/lib/editor/smooth-zoom-settings';
import type { AspectRatio, Clip, MediaAsset } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import { EffectSlider } from './effect-slider';
import { InspectorSelect } from './inspector-select';
import './smooth-zoom-controls.css';

type Props = { clip: Clip; asset: MediaAsset; aspectRatio: AspectRatio; fps: number; disabled?: boolean; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void };
const easingLabels = { linear: 'Linear', 'ease-in-out': 'Ease in / out', 'ease-out': 'Ease out', 'focused-spring': 'Focused spring' };

function initialSettings(clip: Clip): SmoothZoomSettings {
  if (clip.smoothZoom && !clip.motionOffset) return clip.smoothZoom;
  const movement = Math.min(.6, clip.duration / 3);
  return { start: 0, inDuration: movement, holdDuration: Math.max(0, clip.duration - movement * 2), outDuration: movement, scale: 1.5, centerX: .5, centerY: .5, easing: 'ease-in-out' };
}

/** Production renders the same canonical keys; only manual authoring controls are local. */
export function SmoothZoomControls(props: Props) {
  return process.env.NODE_ENV !== 'production' ? <DevelopmentZoomControls {...props} /> : null;
}

function DevelopmentZoomControls({ clip, asset, aspectRatio, fps, disabled = false, onChange, onPreview }: Props) {
  const [settings, setSettings] = useState(() => initialSettings(clip));
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setSettings(initialSettings(clip)); setReplace(false); setError(''); }, [clip.id, clip.smoothZoom, clip.motionOffset, clip.duration]);
  const previewCallback = useRef(onPreview); previewCallback.current = onPreview;
  useEffect(() => () => previewCallback.current?.(null), []);
  useEffect(() => { if (disabled) previewCallback.current?.(null); }, [disabled]);
  const changedOrigin = !!clip.smoothZoom && !!clip.motionOffset;
  const custom = !!clip.motion?.length && !clip.smoothZoom;
  const finish = settings.start + settings.inDuration + (settings.outDuration > 0 ? settings.holdDuration + settings.outDuration : 0);
  const ratio = Math.max(clip.duration, finish, 1 / fps);
  const positions = [settings.start, settings.start + settings.inDuration, ...(settings.outDuration > 0 ? [settings.start + settings.inDuration + settings.holdDuration, finish] : [])];
  function preview(changes: Partial<SmoothZoomSettings> | null) {
    if (!changes || disabled) { onPreview?.(null); return; }
    try { onPreview?.(smoothZoomPatch(clip, asset, aspectRatio, { ...settings, ...changes }, { replace })); }
    catch { onPreview?.(null); }
  }
  function apply() {
    if (disabled) return;
    try { const patch = smoothZoomPatch(clip, asset, aspectRatio, settings, { replace }); onChange(patch); onPreview?.(null); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The zoom could not be applied.'); }
  }
  const timing = (key: 'start' | 'inDuration' | 'holdDuration' | 'outDuration', label: string) => <NumberControl label={label} min={key === 'inDuration' ? 1 / fps : 0} max={clip.duration} step={1 / fps} value={settings[key]} disabled={disabled} unit="s" onCommit={value => { setSettings(previous => ({ ...previous, [key]: value })); setError(''); }}/>;
  return <details className="footage-disclosure smooth-zoom-controls" aria-label="Smooth zoom keyframes">
    <summary><span>Smooth zoom <small>Development</small></span><ChevronDown size={12}/></summary>
    <div className="footage-settings-section">
      <div className="smooth-zoom-keyframes" role="img" aria-label={`Zoom in from ${settings.start.toFixed(2)} to ${(settings.start + settings.inDuration).toFixed(2)} seconds${settings.outDuration > 0 ? `, return to normal by ${finish.toFixed(2)} seconds` : ', then hold'} across ${clip.duration.toFixed(2)} seconds`}><svg viewBox="0 0 260 44" preserveAspectRatio="none" aria-hidden="true"><path d={`M0 36 L${positions[0] / ratio * 260} 36 L${positions[1] / ratio * 260} 8 ${settings.outDuration > 0 ? `L${positions[2] / ratio * 260} 8 L${positions[3] / ratio * 260} 36 L260 36` : 'L260 8'}`} fill="none" stroke="currentColor" strokeWidth="1.5"/>{positions.map((position, index) => <rect key={index} x={position / ratio * 260 - 2.5} y={(index === 1 || index === 2 ? 8 : 36) - 2.5} width="5" height="5" transform={`rotate(45 ${position / ratio * 260} ${index === 1 || index === 2 ? 8 : 36})`} fill="currentColor"/>)}</svg></div>
      <div className="smooth-zoom-timing">{timing('start', 'Zoom start')}{timing('inDuration', 'Zoom in')}{timing('holdDuration', 'Hold')}{timing('outDuration', 'Zoom out')}</div>
      <p className="smooth-zoom-note">Set Zoom out to 0 to stay zoomed in. Times are relative to this clip.</p>
      <EffectSlider label="Zoom amount" value={settings.scale} bounds={[1, 3]} step={.01} format={value => `${Math.round(value * 100)}%`} disabled={disabled} onPreview={value => preview(value === null ? null : { scale: value })} onCommit={scale => setSettings(previous => ({ ...previous, scale }))}/>
      {(['centerX', 'centerY'] as const).map((key, index) => <EffectSlider key={key} label={`Source focus ${index === 0 ? 'X' : 'Y'}`} value={settings[key]} bounds={[0, 1]} step={.01} format={value => `${Math.round(value * 100)}%`} disabled={disabled} onPreview={value => preview(value === null ? null : { [key]: value })} onCommit={value => setSettings(previous => ({ ...previous, [key]: value }))}/>)}
      <InspectorSelect label="Zoom easing" value={settings.easing} disabled={disabled} options={SMOOTH_ZOOM_EASINGS.map(value => ({ value, label: easingLabels[value] }))} onChange={easing => setSettings(previous => ({ ...previous, easing }))}/>
      <InspectorSelect label="Zoom framing" value={settings.framing ?? 'anchor'} disabled={disabled} options={[{value:'anchor',label:'Keep target in place'},{value:'center',label:'Center target'}]} onChange={framing => setSettings(previous => ({ ...previous, framing }))}/>
      {changedOrigin && <p className="smooth-zoom-note">This segment retains its original zoom phase after trimming. Applying replaces its zoom using the timing above.</p>}
      {custom && <label className="smooth-zoom-replace"><input type="checkbox" checked={replace} disabled={disabled} onChange={event => setReplace(event.target.checked)}/>Replace existing custom motion</label>}
      <div className="smooth-zoom-actions"><button type="button" className="footage-crop" disabled={disabled || custom && !replace} onClick={apply}>{clip.smoothZoom ? 'Apply zoom changes' : 'Apply zoom'}</button>{clip.smoothZoom && <button type="button" className="footage-crop" disabled={disabled} onClick={() => { onPreview?.(null); onChange({ smoothZoom: undefined, motion: undefined, motionOffset: undefined }); }}>Remove zoom</button>}</div>
      {error && <p className="smooth-zoom-error" role="alert">{error}</p>}
    </div>
  </details>;
}
