'use client';

import type { Clip } from '@/lib/editor/types';
import { AUDIO_ROLES, audioSettings, audioSettingsPatch, type AudioSettingsPatch } from '@/lib/editor/audio-settings';
import { EffectSlider } from './effect-slider';
import { FadeControls } from './fade-controls';
import './audio-controls.css';

export function AudioControls({clip,fps=30,onChange,onPreview}:{clip:Clip;fps?:number;onChange:(patch:Partial<Clip>)=>void;onPreview?:(patch:Partial<Clip>|null)=>void}) {
  const settings=audioSettings(clip);
  function change(patch:AudioSettingsPatch) { onChange(audioSettingsPatch(clip,patch)); }
  function preview(patch:AudioSettingsPatch|null) { onPreview?.(patch===null?null:audioSettingsPatch(clip,patch)); }
  const seconds=(value:number)=>`${Number(value.toFixed(2))} s`;
  return <div className="audio-controls" aria-label="Audio controls">
    <label className="audio-role"><span>Role</span><select aria-label="Audio role" value={settings.role} onChange={event=>change({role:event.target.value as typeof settings.role})}>{AUDIO_ROLES.map(role=><option key={role} value={role}>{role==='original'?'Original sound':role==='voice'?'Voice':'Music'}</option>)}</select></label>
    <EffectSlider label="Clip volume" value={clip.volume??1} bounds={[0,2]} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={volume=>onPreview?.(volume===null?null:{volume})} onCommit={volume=>onChange({volume})}/>
    <FadeControls settings={settings} maximum={{fadeIn:clip.duration,fadeOut:clip.duration}} fps={fps} onChange={change} onPreview={preview}/>
    {settings.role==='music'&&<fieldset><legend>Voice balance</legend><label className="audio-duck-toggle"><input type="checkbox" aria-label="Lower music under voice clips" checked={settings.ducking.enabled} onChange={event=>change({ducking:{enabled:event.target.checked}})}/>Lower music under voice clips</label>
      {settings.ducking.enabled&&<><EffectSlider label="Music reduction" value={settings.ducking.amount} bounds={[0,1]} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={amount=>preview(amount===null?null:{ducking:{amount}})} onCommit={amount=>change({ducking:{amount}})}/><details><summary>Ducking timing</summary><div className="audio-duck-timing">{(['attack','release'] as const).map(key=><EffectSlider key={key} label={key==='attack'?'Lowering time':'Recovery time'} value={settings.ducking[key]} bounds={[0,5]} step={.01} format={seconds} disabled={false} onPreview={value=>preview(value===null?null:{ducking:{[key]:value}})} onCommit={value=>change({ducking:{[key]:value}})}/>)}</div></details></>}
    </fieldset>}
  </div>;
}
