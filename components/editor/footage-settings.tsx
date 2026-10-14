'use client';

import { ChevronDown, Crop, Film, Image as ImageIcon } from 'lucide-react';
import { BLEND_MODES } from '@/lib/editor/clip-effects';
import type { Clip, MediaAsset } from '@/lib/editor/types';
import { NumberControl } from './visual-controls';
import { EffectSlider, PlaybackSpeedControls } from './visual-effects-controls';
import { DEFAULT_TRANSFORM } from '@/lib/editor/types';
import './footage-settings.css';

function blendLabel(mode: NonNullable<Clip['blendMode']>) {
  return mode === 'plus-lighter' ? 'Add / lighten' : mode[0].toUpperCase() + mode.slice(1);
}

export function FootageSelection({ clip, asset }: { clip: Clip; asset?: MediaAsset }) {
  const Icon = clip.kind === 'image' ? ImageIcon : Film;
  return <div className="footage-selection">
    <span className="footage-selection-icon"><Icon size={16} strokeWidth={1.5}/></span>
    <div><small>{clip.kind === 'image' ? 'Image clip' : 'Video clip'}</small><p title={asset?.fileName}>{asset?.fileName || 'Selected footage'}</p></div>
  </div>;
}

export function FootageSettings({ clip, audioClip, asset, onChange, onPreview, onPlaybackRateChange, onCrop, cropping }: {
  clip: Clip; audioClip?: Clip; asset?: MediaAsset; onChange: (patch: Partial<Clip>) => void;
  onPreview?: (patch:Partial<Clip>|null)=>void;
  onPlaybackRateChange?: (rate: number) => void; onCrop: () => void; cropping: boolean;
}) {
  const hasVolume = clip.kind === 'video' && (!clip.audioSeparated || !!audioClip);
  const hasSpeed = clip.kind === 'video' && !!onPlaybackRateChange;
  const blendMode = clip.blendMode ?? 'normal';
  return <div className="footage-settings" aria-label="Footage settings">
    <FootageSelection clip={clip} asset={asset}/>
    <section className="footage-settings-section" aria-label="Framing">
      <div className="footage-section-heading"><h3>Framing</h3><button type="button" className="footage-crop" aria-pressed={cropping} disabled={!asset?.width || !asset?.height || !asset.url} onClick={onCrop}><Crop size={13}/>{cropping ? 'Done cropping' : 'Crop'}</button></div>
      <div className="footage-fit" role="group" aria-label="Frame fit">
        <button type="button" disabled={cropping} aria-pressed={clip.fit !== 'contain'} title="Fill the frame; some edges may be cropped." onClick={() => onChange({ fit: 'cover' })}>Fill frame</button>
        <button type="button" disabled={cropping} aria-pressed={clip.fit === 'contain'} title="Keep the entire clip visible inside the frame." onClick={() => onChange({ fit: 'contain' })}>Show full clip</button>
      </div>
      {cropping && <p className="footage-crop-note">Drag the edges in the preview. Escape cancels.</p>}
    </section>
    {(hasSpeed || hasVolume) && <section className="footage-settings-section footage-playback" aria-label="Playback">
      <div className="footage-section-heading"><h3>Playback</h3></div>
      {hasSpeed && <PlaybackSpeedControls clip={clip} onChange={onPlaybackRateChange!}/>}
      {hasVolume && <NumberControl label="Clip volume" min={0} max={200} value={Math.round(((audioClip ?? clip).volume ?? 1) * 100)} unit="%" onCommit={volume => onChange({ volume: volume / 100 })}/>}
    </section>}
    <details className="footage-compositing">
      <summary><span>Compositing</span><small>{blendLabel(blendMode)}</small><ChevronDown size={13}/></summary>
      <EffectSlider label="Opacity" value={clip.transform?.opacity??1} bounds={[0,1]} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={value=>onPreview?.(value===null?null:{transform:{...DEFAULT_TRANSFORM,...clip.transform,opacity:value}})} onCommit={opacity=>onChange({transform:{...DEFAULT_TRANSFORM,...clip.transform,opacity}})}/>
      <label className="footage-blend"><span>Blend mode</span><select aria-label="Blend mode" value={blendMode} onChange={event => onChange({ blendMode: event.currentTarget.value as Clip['blendMode'] })}>{BLEND_MODES.map(mode => <option key={mode} value={mode}>{blendLabel(mode)}</option>)}</select></label>
    </details>
  </div>;
}
