'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DEFAULT_COLOR_GRADE, DEFAULT_DITHER, DEFAULT_INVERT, DEFAULT_GLITCH, DEFAULT_ZOOM_BLUR, VISUAL_EFFECT_LIMITS, type VisualEffects } from '@/lib/editor/visual-effects';
import type { Clip } from '@/lib/editor/types';
import { CINEMATIC_BAR_LIMITS, EFFECT_CATALOG, cinematicBarSettings, type CinematicBarSettings, type EffectPreset } from '@/lib/editor/clip-effects';
import { PLAYBACK_RATES, playbackRateOf } from '@/lib/editor/playback-rate';
import { ColorControl } from './color-control';
import { EffectIcon } from './effect-icon';
import './visual-effects-controls.css';

type Props = { onlyEffect?: keyof VisualEffects; clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void; onPlaybackRateChange?: (rate: number) => void; onAddEffect?: (preset: EffectPreset) => void };
type EffectKey = keyof VisualEffects;
const rangeKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function EffectSlider({ label, value, bounds, step = .01, format, disabled, onPreview, onCommit }: {
  label: string; value: number; bounds: readonly [number, number]; step?: number; format: (value: number) => string; disabled: boolean;
  onPreview: (value: number | null) => void; onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const gesture = useRef<{ initial: number; value: number } | null>(null);
  const frame = useRef(0);
  const callbacks = useRef({ onPreview, onCommit }); callbacks.current = { onPreview, onCommit };
  const id = useId();
  function cancel() {
    if (!gesture.current) return;
    cancelAnimationFrame(frame.current); frame.current = 0;
    setDraft(gesture.current.initial); gesture.current = null;
    callbacks.current.onPreview(null);
  }
  function commit() {
    const current = gesture.current;
    if (!current) return;
    cancelAnimationFrame(frame.current); frame.current = 0; gesture.current = null;
    if (current.value === current.initial) callbacks.current.onPreview(null);
    else { callbacks.current.onPreview(current.value); callbacks.current.onCommit(current.value); }
  }
  useEffect(() => {
    if (gesture.current && (disabled || gesture.current.initial !== value)) cancel();
    if (!gesture.current) setDraft(value);
  }, [value, disabled]);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (gesture.current) callbacks.current.onPreview(null);
  }, []);
  const progress = bounds[1] > bounds[0] ? Math.min(100, Math.max(0, (draft - bounds[0]) / (bounds[1] - bounds[0]) * 100)) : 0;
  return <div className="effect-slider" data-disabled={disabled || undefined}>
    <span className="effect-slider-fill" aria-hidden="true" style={{ width: `${progress}%` }}/>
    <span className="effect-slider-handle" aria-hidden="true" style={{ left: `clamp(0px, calc(${progress}% - 7px), calc(100% - 2px))` }}/>
    <div className="effect-slider-readout" aria-hidden="true"><span>{label}</span><output htmlFor={id}>{format(draft)}</output></div>
    <input id={id} type="range" aria-label={label} aria-valuetext={format(draft)} min={bounds[0]} max={bounds[1]} step={step} value={draft} disabled={disabled}
      onPointerDown={event => { if (event.button === 0) { gesture.current = { initial: value, value: draft }; event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerUp={commit} onPointerCancel={cancel} onLostPointerCapture={commit} onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel(); }
        else if (rangeKeys.has(event.key)) { event.stopPropagation(); gesture.current ??= { initial: value, value: draft }; }
      }}
      onKeyUp={event => { if (rangeKeys.has(event.key)) { event.stopPropagation(); commit(); } }}
      onChange={event => {
        const next = Number(event.currentTarget.value); setDraft(next);
        if (!gesture.current) { callbacks.current.onCommit(next); return; }
        gesture.current.value = next;
        if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; if (gesture.current) callbacks.current.onPreview(gesture.current.value); });
      }}/>
  </div>;
}

function EffectCard({ name, effectKey, enabled, onToggle, onReset, onRemove, children }: {
  name: string; effectKey: EffectKey; enabled: boolean; onToggle: () => void; onReset: () => void; onRemove: () => void; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return <section className="visual-effect-card" data-effect={effectKey} data-enabled={enabled} aria-label={`${name} effect`}>
    <div className="visual-effect-heading">
      <button type="button" className="effect-enabled" role="switch" aria-checked={enabled} aria-label={`Enable ${name}`} onClick={onToggle}><span/></button>
      <button type="button" className="effect-collapse" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}><span><EffectIcon name={effectKey} size={16}/>{name}</span><ChevronDown size={12}/></button>
      <button type="button" className="effect-icon-button" aria-label={`Reset ${name}`} title={`Reset ${name}`} onClick={onReset}><RotateCcw size={12}/></button>
      <button type="button" className="effect-icon-button" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={onRemove}><Trash2 size={12}/></button>
    </div>
    <div id={id} className="visual-effect-fields" hidden={!open}>{children}</div>
  </section>;
}

const decimal = (value: number) => value.toFixed(2);
const integer = (value: number) => String(Math.round(value));
const percent = (value: number) => `${Math.round(value * 100)}%`;
const pixels = (value: number) => `${Math.round(value)} px`;
const effectNames = { colorGrade: 'Color', zoomBlur: 'Zoom blur', glitch: 'Glitch', invert: 'Invert colors', dither: 'Dither' } as const;
const effectDefaults = { colorGrade: DEFAULT_COLOR_GRADE, zoomBlur: DEFAULT_ZOOM_BLUR, glitch: DEFAULT_GLITCH, invert: DEFAULT_INVERT, dither: DEFAULT_DITHER };

export function AppliedVisualEffects({ clip, onSelect, onAdd }: { clip: Clip; onSelect: (effect: EffectKey) => void; onAdd: () => void }) {
  const applied = (Object.keys(effectNames) as EffectKey[]).filter(key => clip[key]);
  return <section className="applied-visual-effects" aria-label="Applied effects">
    <div className="applied-effects-heading"><h3>Applied effects</h3><button type="button" aria-label="Add effect" onClick={onAdd}><Plus size={13}/>Add effect</button></div>
    {applied.length ? <div className="applied-effects-list">{applied.map(key => <button key={key} type="button" className="applied-effect-row" aria-label={`Edit ${effectNames[key]}`} onClick={() => onSelect(key)}><EffectIcon name={key} size={15}/><span>{effectNames[key]}</span><small>{clip[key]?.enabled ? 'On' : 'Off'}</small><ChevronRight size={13}/></button>)}</div> : <p>No effects applied.</p>}
  </section>;
}


export function CinematicBarsControls({ clip, onChange, onPreview }: Pick<Props, 'clip' | 'onChange' | 'onPreview'>) {
  const settings = cinematicBarSettings(clip);
  const patch = (key: keyof CinematicBarSettings, value: number): Partial<Clip> => ({ cinematicBars: { ...settings, [key]: value } });
  return <div className="visual-effects-controls" aria-label="Cinematic bars settings">
    <div className="inspector-selection"><small>Effect</small><p>Cinematic bars</p></div>
    <EffectSlider label="Size" value={settings.size} bounds={CINEMATIC_BAR_LIMITS.size} format={percent} disabled={false} onPreview={value => onPreview?.(value === null ? null : patch('size', value))} onCommit={value => onChange(patch('size', value))}/>
    <EffectSlider label="Speed" value={settings.speed} bounds={CINEMATIC_BAR_LIMITS.speed} step={.25} format={value => `${value}×`} disabled={false} onPreview={value => onPreview?.(value === null ? null : patch('speed', value))} onCommit={value => onChange(patch('speed', value))}/>
  </div>;
}

export function PlaybackSpeedControls({ clip, onChange }: { clip: Clip; onChange: (rate: number) => void }) {
  const rate = playbackRateOf(clip);
  return <section className="playback-speed-controls" aria-label="Playback speed">
    <label><span><EffectIcon name="speed-up" size={16}/>Speed</span><select aria-label="Playback speed" value={rate} onChange={event => onChange(Number(event.currentTarget.value))}>
      {!PLAYBACK_RATES.some(value => value === rate) && <option value={rate}>{rate}×</option>}
      {PLAYBACK_RATES.map(value => <option key={value} value={value}>{value}×{value === 1 ? ' · Normal' : ''}</option>)}
    </select></label>
  </section>;
}

export function TimedEffectPresets({ onAdd }: { onAdd: (preset: EffectPreset) => void }) {
  return <section className="timed-effect-presets" aria-label="Timed effect presets"><p>Add at playhead</p>
    {(['cinematic-bars', 'quick-zoom-in', 'quick-zoom-out'] as const).map(preset => <button key={preset} type="button" onClick={() => onAdd(preset)}><EffectIcon name={preset} size={16}/><span>{EFFECT_CATALOG[preset].label}</span><Plus size={12}/></button>)}
    <small>Move or trim the effect on the timeline.</small>
  </section>;
}

export function VisualEffectsControls({ clip, onChange, onPreview, onPlaybackRateChange, onAddEffect, onlyEffect }: Props) {
  const color = !onlyEffect || onlyEffect === 'colorGrade' ? clip.colorGrade : undefined;
  const blur = !onlyEffect || onlyEffect === 'zoomBlur' ? clip.zoomBlur : undefined;
  const glitch = !onlyEffect || onlyEffect === 'glitch' ? clip.glitch : undefined;
  const invert = !onlyEffect || onlyEffect === 'invert' ? clip.invert : undefined;
  const dither = !onlyEffect || onlyEffect === 'dither' ? clip.dither : undefined;
  const missing = (Object.keys(effectNames) as EffectKey[]).filter(key => !clip[key]);
  function cardProps(key: EffectKey) {
    return {
      name: effectNames[key], effectKey: key, enabled: !!clip[key]?.enabled,
      onToggle: () => onChange({ [key]: { ...clip[key], enabled: !clip[key]?.enabled } }),
      onReset: () => onChange({ [key]: { ...effectDefaults[key], enabled: !!clip[key]?.enabled } }),
      onRemove: () => onChange({ [key]: undefined }),
    };
  }
  function preview(patch: Partial<Clip> | null) { onPreview?.(patch); }
  return <div className="visual-effects-controls">
    {!onlyEffect && clip.kind === 'video' && onPlaybackRateChange && <PlaybackSpeedControls clip={clip} onChange={onPlaybackRateChange}/>}
    {!onlyEffect && onAddEffect && <TimedEffectPresets onAdd={onAddEffect}/>}
    {color && <EffectCard {...cardProps('colorGrade')}>{([
      ['exposure', 'Exposure', .01, decimal], ['contrast', 'Contrast', .01, decimal], ['saturation', 'Saturation', .01, decimal],
      ['temperature', 'Temperature', 1, integer], ['tint', 'Tint', 1, integer], ['vibrance', 'Vibrance', 1, integer],
    ] as const).map(([key, label, step, format]) => <EffectSlider key={key} label={label} value={color[key]} bounds={VISUAL_EFFECT_LIMITS.colorGrade[key]} step={step} format={format} disabled={!color.enabled} onPreview={value => preview(value === null ? null : { colorGrade: { ...color, [key]: value } })} onCommit={value => onChange({ colorGrade: { ...color, [key]: value } })}/>)}</EffectCard>}
    {blur && <EffectCard {...cardProps('zoomBlur')}>{([
      ['amount', 'Amount'], ['centerX', 'Center X'], ['centerY', 'Center Y'],
    ] as const).map(([key, label]) => <EffectSlider key={key} label={label} value={blur[key]} bounds={VISUAL_EFFECT_LIMITS.zoomBlur[key]} format={percent} disabled={!blur.enabled} onPreview={value => preview(value === null ? null : { zoomBlur: { ...blur, [key]: value } })} onCommit={value => onChange({ zoomBlur: { ...blur, [key]: value } })}/>)}</EffectCard>}
    {glitch && <EffectCard {...cardProps('glitch')}>{([
      ['intensity', 'Intensity', .01, percent], ['blockSize', 'Block size', 1, pixels], ['rgbSplit', 'RGB split', 1, pixels],
    ] as const).map(([key, label, step, format]) => <EffectSlider key={key} label={label} value={glitch[key]} bounds={VISUAL_EFFECT_LIMITS.glitch[key]} step={step} format={format} disabled={!glitch.enabled} onPreview={value => preview(value === null ? null : { glitch: { ...glitch, [key]: value } })} onCommit={value => onChange({ glitch: { ...glitch, [key]: value } })}/>)}</EffectCard>}
    {invert && <EffectCard {...cardProps('invert')}><EffectSlider label="Amount" value={invert.amount} bounds={VISUAL_EFFECT_LIMITS.invert.amount} format={percent} disabled={!invert.enabled} onPreview={value => preview(value === null ? null : { invert: { ...invert, amount: value } })} onCommit={value => onChange({ invert: { ...invert, amount: value } })}/></EffectCard>}
    {dither && <EffectCard {...cardProps('dither')}>{([
      ['amount','Strength',.01,percent],['levels','Color levels',1,integer],['size','Pattern size',1,pixels],
    ] as const).map(([key,label,step,format])=><EffectSlider key={key} label={label} value={dither[key]} bounds={VISUAL_EFFECT_LIMITS.dither[key]} step={step} format={format} disabled={!dither.enabled} onPreview={value=>preview(value===null?null:{dither:{...dither,[key]:value}})} onCommit={value=>onChange({dither:{...dither,[key]:value}})}/>)}<fieldset className="dither-colors" disabled={!dither.enabled}><label>Dark color<ColorControl label="Dither dark color" value={dither.shadowColor ?? '#000000'} onCommit={shadowColor=>onChange({dither:{...dither,shadowColor}})}/></label><label>Light color<ColorControl label="Dither light color" value={dither.highlightColor ?? '#ffffff'} onCommit={highlightColor=>onChange({dither:{...dither,highlightColor}})}/></label>{(dither.shadowColor || dither.highlightColor) && <button type="button" className="effect-color-reset" onClick={()=>onChange({dither:{...dither,shadowColor:undefined,highlightColor:undefined}})}>Original colors</button>}</fieldset></EffectCard>}
    {!color && !blur && !glitch && !invert && !dither && <p className="visual-effects-empty">Add an effect to this clip.</p>}
    {!onlyEffect && <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="visual-effects-add" disabled={!missing.length}><Plus size={13}/>Add effect</button></DropdownMenuTrigger><DropdownMenuContent className="visual-effects-menu" align="start">{missing.map(key => {
      return <DropdownMenuItem key={key} onSelect={() => onChange({ [key]: { ...effectDefaults[key], enabled: true } })}><EffectIcon name={key} size={16}/>{effectNames[key]}</DropdownMenuItem>;
    })}</DropdownMenuContent></DropdownMenu>}
  </div>;
}
