import type { Clip,Timeline } from './types';

export const AUDIO_ROLES=['original','voice','music'] as const;
export type AudioRole=typeof AUDIO_ROLES[number];
export type AudioDucking={enabled:boolean;amount:number;attack:number;release:number};
export type AudioSettings={role:AudioRole;fadeIn:number;fadeOut:number;ducking:AudioDucking};
export type AudioSettingsPatch=Partial<Omit<AudioSettings,'ducking'>>&{ducking?:Partial<AudioDucking>};
export const AUDIO_LIMITS={fadeIn:[0,86400],fadeOut:[0,86400],amount:[0,1],attack:[0,5],release:[0,5]} as const;
export const DEFAULT_AUDIO_SETTINGS:Readonly<AudioSettings>={role:'original',fadeIn:0,fadeOut:0,ducking:{enabled:false,amount:.65,attack:.12,release:.25}};

/** Keep authored edge fades when trimming; resolve them proportionally to fit the retained clip. */
export function audioSettings(clip:Pick<Clip,'audio'|'duration'>):AudioSettings{
  const settings=clip.audio??DEFAULT_AUDIO_SETTINGS,total=settings.fadeIn+settings.fadeOut;
  const scale=total>clip.duration&&total>0?clip.duration/total:1;
  return {...settings,fadeIn:settings.fadeIn*scale,fadeOut:settings.fadeOut*scale,ducking:{...settings.ducking}};
}
export function validateAudioSettings(clip:Pick<Clip,'kind'|'audio'>){
  if(clip.audio===undefined)return;
  if(clip.kind!=='audio')throw new Error('Audio settings belong to audio clips; choose the linked sound of a video.');
  if(!AUDIO_ROLES.includes(clip.audio.role))throw new Error('Choose original, voice or music for the audio role.');
  const check=(value:number,key:keyof typeof AUDIO_LIMITS)=>{const[min,max]=AUDIO_LIMITS[key];if(!Number.isFinite(value)||value<min||value>max)throw new Error(`Audio ${key} must be between ${min} and ${max}.`)};
  check(clip.audio.fadeIn,'fadeIn');check(clip.audio.fadeOut,'fadeOut');
  if(!clip.audio.ducking||typeof clip.audio.ducking.enabled!=='boolean')throw new Error('Choose whether to lower music under voice clips.');
  for(const key of ['amount','attack','release'] as const)check(clip.audio.ducking[key],key);
}

/** A linked video targets its separate sound. This operation never touches footage or timing. */
export function configureAudio(timeline:Timeline,clipId:string,changes:AudioSettingsPatch):Timeline{
  const selected=timeline.clips.find(clip=>clip.id===clipId);
  const target=selected?.kind==='video'&&selected.linkedClipId?timeline.clips.find(clip=>clip.id===selected.linkedClipId&&clip.linkedClipId===selected.id):selected;
  if(!target||target.kind!=='audio')throw new Error('Choose an audio clip or a video with linked sound.');
  if(!Object.values(changes).some(value=>value!==undefined))throw new Error('Specify an audio control.');
  const previous=target.audio??DEFAULT_AUDIO_SETTINGS;
  const audio={...previous,...changes,ducking:{...previous.ducking,...changes.ducking}};
  validateAudioSettings({...target,audio});
  for(const key of ['fadeIn','fadeOut'] as const)if(changes[key]!==undefined&&changes[key]!>target.duration)throw new Error('A requested audio fade cannot exceed the retained clip duration.');
  return {...timeline,clips:timeline.clips.map(clip=>clip.id===target.id?{...clip,audio}:clip)};
}

type Range={start:number;end:number};
type Point={t:number;v:number};
const step=1e-6;
/** Explicit voice-clip coverage drives ducking; no speech detection or analysis is inferred. */
function voiceRanges(timeline:Pick<Timeline,'clips'>,music:Clip,ducking:AudioDucking){
  const start=music.start,end=start+music.duration;
  const ranges=timeline.clips.filter(clip=>clip.kind==='audio'&&clip.id!==music.id&&clip.audio?.role==='voice'&&(clip.volume??1)>0&&clip.start-ducking.attack<end&&clip.start+clip.duration+ducking.release>start)
    .map(clip=>({start:clip.start,end:clip.start+clip.duration})).sort((a,b)=>a.start-b.start);
  const merged:Range[]=[];
  for(const range of ranges){const previous=merged.at(-1);if(previous&&range.start<=previous.end+ducking.attack+ducking.release)previous.end=Math.max(previous.end,range.end);else merged.push({...range})}
  return merged;
}
/** One clip-local volume lane is consumed by native HyperFrames preview and sample-wise FFmpeg export. */
export function audioVolumeEnvelope(timeline:Pick<Timeline,'clips'>,clip:Clip,volume=clip.volume??1){
  const settings=audioSettings(clip),ducking=settings.ducking;
  const ranges=clip.kind==='audio'&&settings.role==='music'&&ducking.enabled&&ducking.amount>0?voiceRanges(timeline,clip,ducking):[];
  const gain=(time:number)=>ranges.reduce((level,range)=>{
    let attenuation=0;
    if(time>=range.start&&time<=range.end)attenuation=ducking.amount;
    else if(ducking.attack>0&&time>=range.start-ducking.attack&&time<range.start)attenuation=ducking.amount*(time-range.start+ducking.attack)/ducking.attack;
    else if(ducking.release>0&&time>range.end&&time<range.end+ducking.release)attenuation=ducking.amount*(1-(time-range.end)/ducking.release);
    return Math.min(level,1-attenuation);
  },1)*volume;
  const end=clip.start+clip.duration,times=new Set([clip.start,end]);
  for(const range of ranges)for(const time of [range.start-(ducking.attack||step),range.start,range.end,range.end+(ducking.release||step)])if(time>clip.start&&time<end)times.add(time);
  const points:Point[]=Array.from(times).sort((a,b)=>a-b).map(time=>({t:Math.max(0,time-clip.start),v:gain(time)}));
  // Keep the same documented native automation limit; never silently omit voice ranges.
  if(points.length>512)throw new Error('Too many separate voice ranges for one music clip. Split the music into shorter clips.');
  return JSON.stringify({version:1,lanes:[{target:'volume',points}]});
}
export function validateAudioTimeline(timeline:Pick<Timeline,'clips'>){
  for(const clip of timeline.clips){validateAudioSettings(clip);if(clip.kind==='audio'&&clip.audio?.role==='music'&&clip.audio.ducking.enabled)audioVolumeEnvelope(timeline,clip)}
}
