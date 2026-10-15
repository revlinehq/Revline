'use client';

import { useId, useState, type ReactNode } from 'react';
import { EffectSlider } from './effect-slider';
import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { VISUAL_EFFECT_LIMITS, visualEffectsPatch, type VisualEffects } from '@/lib/editor/visual-effects';
import { NEON_EDGE_LIMITS } from '@/lib/editor/neon-edges';
import { visualEffectActionPatch } from '@/lib/editor/visual-effect-actions';
import type { Clip } from '@/lib/editor/types';
import { CINEMATIC_BAR_LIMITS, EFFECT_CATALOG, cinematicBarSettings, type CinematicBarSettings, type EffectPreset } from '@/lib/editor/clip-effects';
import { PLAYBACK_RATES, playbackRateOf } from '@/lib/editor/playback-rate';
import { ColorControl } from './color-control';
import { EffectIcon } from './effect-icon';
import './visual-effects-controls.css';

type Props = { onlyEffect?: keyof VisualEffects; clip: Clip; onChange: (patch: Partial<Clip>) => void; onPreview?: (patch: Partial<Clip> | null) => void; onPlaybackRateChange?: (rate: number) => void; onAddEffect?: (preset: EffectPreset) => void };
type EffectKey = Exclude<keyof VisualEffects, 'softBlur' | 'frameCorners'>;
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
const speed = (value: number) => `${value.toFixed(2)}×`;
const edgePosition = (value: number) => `${Math.round(value * 360)}°`;
const degrees = (value: number) => `${Math.round(value)}°`;
const effectNames = { colorGrade: 'Color', zoomBlur: 'Zoom blur', glitch: 'Glitch', invert: 'Invert colors', dither: 'Dither', neonEdges: 'Neon edges', lensDistortion: 'Lens distortion', filmOverlay: 'Film overlay', vhs: 'VHS overlay', lightLeak: 'Light leak', directionalBlur: 'Directional blur', turbulentDisplace: 'Turbulent displacement', lightSweep: 'Light sweep', frameDistortion: 'Frame distortion' } as const;

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
    <EffectSlider label="Speed" ariaLabel="Playback speed" value={rate} bounds={[PLAYBACK_RATES[0], PLAYBACK_RATES[PLAYBACK_RATES.length - 1]]} step={.05} format={value => `${Number(value.toFixed(2))}×${value === 1 ? ' · Normal' : ''}`} disabled={false} onPreview={() => {}} onCommit={onChange}/>
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
  const neon = !onlyEffect || onlyEffect === 'neonEdges' ? clip.neonEdges : undefined;
  const lens = !onlyEffect || onlyEffect === 'lensDistortion' ? clip.lensDistortion : undefined;
  const film = !onlyEffect || onlyEffect === 'filmOverlay' ? clip.filmOverlay : undefined;
  const vhs = !onlyEffect || onlyEffect === 'vhs' ? clip.vhs : undefined;
  const leak = !onlyEffect || onlyEffect === 'lightLeak' ? clip.lightLeak : undefined;
  const directional = !onlyEffect || onlyEffect === 'directionalBlur' ? clip.directionalBlur : undefined;
  const turbulence = !onlyEffect || onlyEffect === 'turbulentDisplace' ? clip.turbulentDisplace : undefined;
  const sweep = !onlyEffect || onlyEffect === 'lightSweep' ? clip.lightSweep : undefined;
  const frame = !onlyEffect || onlyEffect === 'frameDistortion' ? clip.frameDistortion : undefined;
  const missing = (Object.keys(effectNames) as EffectKey[]).filter(key => !clip[key]);
  function cardProps(key: EffectKey) {
    return {
      name: effectNames[key], effectKey: key, enabled: !!clip[key]?.enabled,
      onToggle: () => onChange(visualEffectsPatch(clip, { [key]: { enabled: !clip[key]?.enabled } })),
      onReset: () => onChange(visualEffectActionPatch(clip, key, 'reset')),
      onRemove: () => onChange(visualEffectActionPatch(clip, key, 'remove')),
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
    ] as const).map(([key,label,step,format])=><EffectSlider key={key} label={label} value={dither[key]} bounds={VISUAL_EFFECT_LIMITS.dither[key]} step={step} format={format} disabled={!dither.enabled} onPreview={value=>preview(value===null?null:{dither:{...dither,[key]:value}})} onCommit={value=>onChange({dither:{...dither,[key]:value}})}/>)}<fieldset className="dither-colors" disabled={!dither.enabled}><label>Dark color<ColorControl label="Dither dark color" value={dither.shadowColor ?? '#000000'} onCommit={shadowColor=>onChange({dither:{...dither,shadowColor}})}/></label><label>Light color<ColorControl label="Dither light color" value={dither.highlightColor ?? '#ffffff'} onCommit={highlightColor=>onChange({dither:{...dither,highlightColor}})}/></label>{(dither.shadowColor || dither.highlightColor) && <button type="button" className="effect-color-reset" onClick={()=>onChange(visualEffectActionPatch(clip, 'dither', 'original-colors'))}>Original colors</button>}</fieldset></EffectCard>}
    {neon && <EffectCard {...cardProps('neonEdges')}><fieldset className="effect-colors" disabled={!neon.enabled}><label>Edge color<ColorControl label="Neon edge color" value={neon.color} onCommit={color => onChange({ neonEdges: { ...neon, color } })}/></label></fieldset>{([
      ['amount', 'Strength'], ['detail', 'Edge detail'], ['threshold', 'Threshold'], ['glow', 'Glow'],
    ] as const).map(([key, label]) => <EffectSlider key={key} label={label} value={neon[key]} bounds={NEON_EDGE_LIMITS[key]} format={percent} disabled={!neon.enabled} onPreview={value => preview(value === null ? null : { neonEdges: { ...neon, [key]: value } })} onCommit={value => onChange({ neonEdges: { ...neon, [key]: value } })}/>)}</EffectCard>}
    {frame && <EffectCard {...cardProps('frameDistortion')}><EffectSlider label="Bend" value={frame.bend??0} bounds={VISUAL_EFFECT_LIMITS.frameDistortion.bend} format={percent} disabled={!frame.enabled} onPreview={value=>preview(value===null?null:{frameDistortion:{...frame,bend:value}})} onCommit={bend=>onChange({frameDistortion:{...frame,bend}})}/><details className="frame-distortion-advanced"><summary>Perspective &amp; skew</summary>{([
      ['horizontal','Horizontal tilt'],['vertical','Vertical tilt'],['skew','Skew'],
    ] as const).map(([key,label])=><EffectSlider key={key} label={label} value={frame[key]} bounds={VISUAL_EFFECT_LIMITS.frameDistortion[key]} format={percent} disabled={!frame.enabled} onPreview={value=>preview(value===null?null:{frameDistortion:{...frame,[key]:value}})} onCommit={value=>onChange({frameDistortion:{...frame,[key]:value}})}/>)}</details></EffectCard>}
    {lens && <EffectCard {...cardProps('lensDistortion')}>{([
      ['amount','Bend',.01,percent],['centerX','Center X',.01,percent],['centerY','Center Y',.01,percent],['fringing','Color fringing',.1,pixels],
    ] as const).map(([key,label,step,format])=><EffectSlider key={key} label={label} value={lens[key]} bounds={VISUAL_EFFECT_LIMITS.lensDistortion[key]} step={step} format={format} disabled={!lens.enabled} onPreview={value=>preview(value===null?null:{lensDistortion:{...lens,[key]:value}})} onCommit={value=>onChange({lensDistortion:{...lens,[key]:value}})}/>)}</EffectCard>}
    {film && <EffectCard {...cardProps('filmOverlay')}>{([
      ['amount','Strength'],['grain','Grain'],['dust','Dust'],['scratches','Scratches'],['vignette','Vignette'],['flicker','Flicker'],['warmth','Warmth'],
    ] as const).map(([key,label])=><EffectSlider key={key} label={label} value={film[key]} bounds={VISUAL_EFFECT_LIMITS.filmOverlay[key]} format={percent} disabled={!film.enabled} onPreview={value=>preview(value===null?null:{filmOverlay:{...film,[key]:value}})} onCommit={value=>onChange({filmOverlay:{...film,[key]:value}})}/>)}</EffectCard>}
    {vhs && <EffectCard {...cardProps('vhs')}>{([
      ['amount', 'Strength', percent], ['scanlines', 'Scanlines', percent], ['noise', 'Tape noise', percent], ['bleed', 'Color bleed', percent], ['tracking', 'Tracking', percent], ['speed', 'Speed', speed],
    ] as const).map(([key, label, format]) => <EffectSlider key={key} label={label} value={vhs[key]} bounds={VISUAL_EFFECT_LIMITS.vhs[key]} format={format} disabled={!vhs.enabled} onPreview={value => preview(value === null ? null : { vhs: { ...vhs, [key]: value } })} onCommit={value => onChange({ vhs: { ...vhs, [key]: value } })}/>)}</EffectCard>}
    {leak && <EffectCard {...cardProps('lightLeak')}><fieldset className="effect-colors" disabled={!leak.enabled}><label>Leak color<ColorControl label="Light leak color" value={leak.color} onCommit={color => onChange({ lightLeak: { ...leak, color } })}/></label></fieldset>{([
      ['amount', 'Strength', percent], ['position', 'Edge position', edgePosition], ['spread', 'Spread', percent], ['speed', 'Speed', speed],
    ] as const).map(([key, label, format]) => <EffectSlider key={key} label={label} value={leak[key]} bounds={VISUAL_EFFECT_LIMITS.lightLeak[key]} format={format} disabled={!leak.enabled} onPreview={value => preview(value === null ? null : { lightLeak: { ...leak, [key]: value } })} onCommit={value => onChange({ lightLeak: { ...leak, [key]: value } })}/>)}</EffectCard>}
    {directional && <EffectCard {...cardProps('directionalBlur')}>{([
      ['amount', 'Strength', .1, pixels], ['angle', 'Angle', 1, degrees],
    ] as const).map(([key, label, step, format]) => <EffectSlider key={key} label={label} value={directional[key]} bounds={VISUAL_EFFECT_LIMITS.directionalBlur[key]} step={step} format={format} disabled={!directional.enabled} onPreview={value => preview(value === null ? null : { directionalBlur: { ...directional, [key]: value } })} onCommit={value => onChange({ directionalBlur: { ...directional, [key]: value } })}/>)}</EffectCard>}
    {turbulence && <EffectCard {...cardProps('turbulentDisplace')}>{([
      ['amount', 'Strength', .1, pixels], ['scale', 'Scale', 1, pixels], ['speed', 'Speed', .01, speed],
    ] as const).map(([key, label, step, format]) => <EffectSlider key={key} label={label} value={turbulence[key]} bounds={VISUAL_EFFECT_LIMITS.turbulentDisplace[key]} step={step} format={format} disabled={!turbulence.enabled} onPreview={value => preview(value === null ? null : { turbulentDisplace: { ...turbulence, [key]: value } })} onCommit={value => onChange({ turbulentDisplace: { ...turbulence, [key]: value } })}/>)}</EffectCard>}
    {sweep && <EffectCard {...cardProps('lightSweep')}><fieldset className="effect-colors" disabled={!sweep.enabled}><label>Light color<ColorControl label="Light sweep color" value={sweep.color} onCommit={color => onChange({ lightSweep: { ...sweep, color } })}/></label></fieldset>{([
      ['amount', 'Strength', .01, percent], ['angle', 'Angle', 1, degrees], ['position', 'Position', .01, percent], ['width', 'Width', .01, percent], ['speed', 'Speed', .01, speed],
    ] as const).map(([key, label, step, format]) => <EffectSlider key={key} label={label} value={sweep[key]} bounds={VISUAL_EFFECT_LIMITS.lightSweep[key]} step={step} format={format} disabled={!sweep.enabled} onPreview={value => preview(value === null ? null : { lightSweep: { ...sweep, [key]: value } })} onCommit={value => onChange({ lightSweep: { ...sweep, [key]: value } })}/>)}</EffectCard>}
    {!color && !blur && !glitch && !invert && !dither && !neon && !lens && !film && !vhs && !leak && !directional && !turbulence && !sweep && !frame && <p className="visual-effects-empty">Add an effect to this clip.</p>}
    {!onlyEffect && <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="visual-effects-add" disabled={!missing.length}><Plus size={13}/>Add effect</button></DropdownMenuTrigger><DropdownMenuContent className="visual-effects-menu" align="start">{missing.map(key => {
      return <DropdownMenuItem key={key} onSelect={() => onChange(visualEffectsPatch(clip, { [key]: { enabled: true } }))}><EffectIcon name={key} size={16}/>{effectNames[key]}</DropdownMenuItem>;
    })}</DropdownMenuContent></DropdownMenu>}
  </div>;
}
