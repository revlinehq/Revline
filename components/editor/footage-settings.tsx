'use client';

import { ChevronDown, Crop, Film, Image as ImageIcon } from 'lucide-react';
import type { AspectRatio, Clip, MediaAsset } from '@/lib/editor/types';
import { CameraMotionControls } from './camera-motion-controls';
import { SmoothZoomControls } from './smooth-zoom-controls';
import { MotionKeyframeEditor } from './motion-keyframe-editor';
import { NumberControl } from './visual-controls';
import { PlaybackSpeedControls } from './visual-effects-controls';
import { EffectSlider } from './effect-slider';
import { VISUAL_EFFECT_LIMITS } from '@/lib/editor/visual-effects';
import { DEFAULT_TRANSFORM } from '@/lib/editor/types';
import { BlendModeControls } from './blend-mode-controls';
import { VisualFadeControls } from './visual-fade-controls';
import { useState } from 'react';
import { twoRowLayoutPatch, type TwoRowPosition } from '@/lib/editor/two-row-layout';
import './footage-settings.css';

export function FootageSelection({ clip, asset }: { clip: Clip; asset?: MediaAsset }) {
  const Icon = clip.kind === 'image' ? ImageIcon : Film;
  return <div className="footage-selection">
    <span className="footage-selection-icon"><Icon size={16} strokeWidth={1.5}/></span>
    <div><small>{clip.kind === 'image' ? 'Image clip' : 'Video clip'}</small><p title={asset?.fileName}>{asset?.fileName || 'Selected footage'}</p></div>
  </div>;
}

export function FootageSettings({ clip, audioClip, asset, aspectRatio, readOnly = false, fps = 30, time = 0, onSeek, onChange, onPreview, onPlaybackRateChange, onCrop, cropping }: {
  clip: Clip; audioClip?: Clip; asset?: MediaAsset; onChange: (patch: Partial<Clip>) => void;
  fps?: number; time?: number; onSeek?: (time:number)=>void; onPreview?: (patch:Partial<Clip>|null)=>void;
  aspectRatio?: AspectRatio; readOnly?: boolean;
  onPlaybackRateChange?: (rate: number) => void; onCrop: () => void; cropping: boolean;
}) {
  const hasVolume = clip.kind === 'video' && (!clip.audioSeparated || !!audioClip);
  const hasSpeed = clip.kind === 'video' && !!onPlaybackRateChange;
  const blendMode = clip.blendMode ?? 'normal';
  const [layoutError, setLayoutError] = useState<string | null>(null);
  function placeInRow(row: TwoRowPosition) {
    if (!asset || !aspectRatio) return;
    try { const patch = twoRowLayoutPatch(clip, asset, aspectRatio, row); onChange(patch); setLayoutError(null); }
    catch (error) { setLayoutError(error instanceof Error ? error.message : 'Could not apply the row layout.'); }
  }
  return <div className="footage-settings" aria-label="Footage settings">
    <FootageSelection clip={clip} asset={asset}/>
    <section className="footage-settings-section" aria-label="Framing">
      <div className="footage-section-heading"><h3>Framing</h3><button type="button" className="footage-crop" aria-pressed={cropping} disabled={!asset?.width || !asset?.height || !asset.url} onClick={onCrop}><Crop size={13}/>{cropping ? 'Done cropping' : 'Crop'}</button></div>
      <div className="footage-fit" role="group" aria-label="Frame fit">
        <button type="button" disabled={cropping} aria-pressed={clip.fit !== 'contain'} title="Fill the frame; some edges may be cropped." onClick={() => onChange({ fit: 'cover' })}>Fill frame</button>
        <button type="button" disabled={cropping} aria-pressed={clip.fit === 'contain'} title="Keep the entire clip visible inside the frame." onClick={() => onChange({ fit: 'contain' })}>Show full clip</button>
      </div>
      <div className="footage-section-heading"><h3>Two-row layout</h3></div>
      <div className="footage-fit" role="group" aria-label="Two-row layout">
        <button type="button" disabled={cropping || readOnly || !aspectRatio || !asset?.width || !asset.height} onClick={() => placeInRow('top')}>Top row</button>
        <button type="button" disabled={cropping || readOnly || !aspectRatio || !asset?.width || !asset.height} onClick={() => placeInRow('bottom')}>Bottom row</button>
      </div>
      {layoutError && <p className="footage-crop-note" role="alert">{layoutError}</p>}
      {cropping && <p className="footage-crop-note">Drag the edges in the preview. Escape cancels.</p>}
    </section>
    {process.env.NODE_ENV !== 'production' && asset?.width && asset.height && aspectRatio ? <SmoothZoomControls clip={clip} asset={asset} aspectRatio={aspectRatio} fps={fps} disabled={cropping || readOnly} onChange={onChange} onPreview={onPreview}/> : null}
    {process.env.NODE_ENV !== 'production' && asset?.width && asset.height && aspectRatio ? <CameraMotionControls clip={clip} asset={asset} aspectRatio={aspectRatio} fps={fps} disabled={cropping || readOnly} onChange={onChange} onPreview={onPreview} onSeek={onSeek}/> : null}
    {process.env.NODE_ENV !== 'production' && <MotionKeyframeEditor clip={clip} fps={fps} time={time} disabled={cropping || readOnly} onChange={onChange} onPreview={onPreview} onSeek={onSeek}/>}
    {(hasSpeed || hasVolume) && <details className="footage-disclosure footage-playback" aria-label="Playback">
      <summary><span>Playback</span><ChevronDown size={12}/></summary>
      <div className="footage-settings-section">
      {hasSpeed && <PlaybackSpeedControls clip={clip} onChange={onPlaybackRateChange!}/>}
      {hasVolume && <NumberControl label="Clip volume" min={0} max={200} value={Math.round(((audioClip ?? clip).volume ?? 1) * 100)} unit="%" onCommit={volume => onChange({ volume: volume / 100 })}/>}
      </div>
    </details>}
    <details className="footage-disclosure footage-fades">
      <summary><span>Fades</span><ChevronDown size={12}/></summary>
      <VisualFadeControls clip={clip} fps={fps} onChange={onChange} onPreview={onPreview}/>
    </details>
    <details className="footage-compositing footage-disclosure" aria-label="Compositing">
      <summary><span>Compositing</span><ChevronDown size={12}/></summary>
      <div className="footage-settings-section">
      <EffectSlider label="Opacity" value={clip.transform?.opacity??1} bounds={[0,1]} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={value=>onPreview?.(value===null?null:{transform:{...DEFAULT_TRANSFORM,...clip.transform,opacity:value}})} onCommit={opacity=>onChange({transform:{...DEFAULT_TRANSFORM,...clip.transform,opacity}})}/>
      <EffectSlider label="Blur" value={clip.softBlur?.enabled?clip.softBlur.amount:0} bounds={VISUAL_EFFECT_LIMITS.softBlur.amount} step={.5} format={value=>`${Number(value.toFixed(1))} px`} disabled={false} onPreview={value=>onPreview?.(value===null?null:{softBlur:{enabled:value>0,amount:value}})} onCommit={amount=>onChange({softBlur:{enabled:amount>0,amount}})}/>
      <EffectSlider label="Corner rounding" value={clip.frameCorners?.enabled?clip.frameCorners.amount:0} bounds={VISUAL_EFFECT_LIMITS.frameCorners.amount} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={value=>onPreview?.(value===null?null:{frameCorners:{enabled:value>0,amount:value}})} onCommit={amount=>onChange({frameCorners:{enabled:amount>0,amount}})}/>
      <BlendModeControls value={blendMode} onChange={blendMode => onChange({ blendMode })}/>
      </div>
    </details>
  </div>;
}
