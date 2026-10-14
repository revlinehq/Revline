'use client';

import type { Clip } from '@/lib/editor/types';
import { AUDIO_ROLES, DEFAULT_AUDIO_SETTINGS, audioSettings, type AudioSettingsPatch } from '@/lib/editor/audio-settings';
import { EffectSlider } from './visual-effects-controls';
import './audio-controls.css';

export function AudioControls({clip,onChange,onPreview}:{clip:Clip;onChange:(patch:Partial<Clip>)=>void;onPreview?:(patch:Partial<Clip>|null)=>void}) {
  const settings=audioSettings(clip),authored=clip.audio??DEFAULT_AUDIO_SETTINGS;
  const freshFade = (patch:AudioSettingsPatch) => patch.fadeIn !== undefined || patch.fadeOut !== undefined ? {audioFadeTiming:undefined} : {};
  function change(patch:AudioSettingsPatch) { onChange({audio:{...authored,...patch,ducking:{...authored.ducking,...patch.ducking}},...freshFade(patch)}); }
  function preview(patch:AudioSettingsPatch|null) { onPreview?.(patch===null?null:{audio:{...authored,...patch,ducking:{...authored.ducking,...patch.ducking}},...freshFade(patch)}); }
  const seconds=(value:number)=>`${Number(value.toFixed(2))} s`;
  return <div className="audio-controls" aria-label="Audio controls">
    <label className="audio-role"><span>Role</span><select aria-label="Audio role" value={settings.role} onChange={event=>change({role:event.target.value as typeof settings.role})}>{AUDIO_ROLES.map(role=><option key={role} value={role}>{role==='original'?'Original sound':role==='voice'?'Voice':'Music'}</option>)}</select></label>
    <EffectSlider label="Clip volume" value={clip.volume??1} bounds={[0,2]} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={volume=>onPreview?.(volume===null?null:{volume})} onCommit={volume=>onChange({volume})}/>
    <fieldset><legend>Fades</legend>{(['fadeIn','fadeOut'] as const).map(key=><EffectSlider key={key} label={key==='fadeIn'?'Fade in':'Fade out'} value={settings[key]} bounds={[0,clip.duration]} step={1/30} format={seconds} disabled={false} onPreview={value=>preview(value===null?null:{[key]:value})} onCommit={value=>change({[key]:value})}/>)}</fieldset>
    {settings.role==='music'&&<fieldset><legend>Voice balance</legend><label className="audio-duck-toggle"><input type="checkbox" aria-label="Lower music under voice clips" checked={settings.ducking.enabled} onChange={event=>change({ducking:{enabled:event.target.checked}})}/>Lower music under voice clips</label>
      {settings.ducking.enabled&&<><EffectSlider label="Music reduction" value={settings.ducking.amount} bounds={[0,1]} step={.01} format={value=>`${Math.round(value*100)}%`} disabled={false} onPreview={amount=>preview(amount===null?null:{ducking:{amount}})} onCommit={amount=>change({ducking:{amount}})}/><details><summary>Ducking timing</summary><div className="audio-duck-timing">{(['attack','release'] as const).map(key=><EffectSlider key={key} label={key==='attack'?'Lowering time':'Recovery time'} value={settings.ducking[key]} bounds={[0,5]} step={.01} format={seconds} disabled={false} onPreview={value=>preview(value===null?null:{ducking:{[key]:value}})} onCommit={value=>change({ducking:{[key]:value}})}/>)}</div></details></>}
    </fieldset>}
  </div>;
}
