import captions from './hormozi-demo-captions.json';
import waveform from './hormozi-demo-waveform.json';
import { NEUTRAL_MOTION } from './clip-effects';
import { DEFAULT_TEXT_APPEARANCE } from './text-style';
import { addMediaClip, splitClip } from './operations';
import { EMPTY_SCRIPTED_DEMO, scriptedDemoMedia, type DemoBuildStep } from './scripted-demo';
import { normalizeTimeline, type Clip, type MediaAsset } from './types';

/** The recording take uses a fixed source; composer uploads are only its trigger. */
// Modern Wisdom #610, https://www.youtube.com/watch?v=JuNOFW-oVn8, 19:07–19:52.
// Caption timings were transcribed locally with Whisper; no provider is called at runtime.
export const HORMOZI_DEMO_ASSET: MediaAsset = { _id: 'hormozi-recording-source', kind: 'video', fileName: 'Hormozi-distractions-45s.mp4', url: '/demo/hormozi-distractions.mp4', duration: 45, width: 1280, height: 720, waveform };

function spokenZoom(id:string,start:number,end:number,peak:number,amount:number,centerX:number):Clip {
  const duration=end-start,attack=peak-start;
  const times=[...new Set([0,attack,duration,...Array.from({length:25},(_,i)=>duration*i/24)])].sort((a,b)=>a-b);
  const smooth=(n:number)=>n*n*(3-2*n);
  return {id,kind:'effect',effectPreset:'quick-zoom-in',track:1,start,duration,sourceStart:0,motion:times.map(time=>{
    const weight=smooth(time<=attack?time/attack:(duration-time)/(duration-attack));
    const scale=1+(amount-1)*weight;
    return {...NEUTRAL_MOTION,time,scale,x:(.5-centerX)*(scale-1),y:(.5-.4)*(scale-1)};
  })};
}

/** Real caption layers and event-timed zooms over uninterrupted source audio/video. */
export function hormoziDemoPlan(runId:string) {
  const media=scriptedDemoMedia([HORMOZI_DEMO_ASSET]);
  const initial={...EMPTY_SCRIPTED_DEMO,tracks:{visual:2,overlay:0,audio:1,effects:1}};
  let footage=addMediaClip(initial,{...HORMOZI_DEMO_ASSET,audioAssetId:media.audioByVideo.get(HORMOZI_DEMO_ASSET._id)},`${runId}-video-0`);
  // Editorial boundaries only: every source frame is retained in its original order.
  for(const [i,cut] of [2.5,9.56,13.6,17.98,21.2,25.02,30,33.4,39.4].entries())footage=splitClip(footage,`${runId}-video-${i}`,cut,`${runId}-video-${i+1}`);
  const steps:DemoBuildStep[]=[];
  const text:Clip[]=captions.map((cue,i)=>{
    const start=Math.round(cue.start*30)/30,end=Math.min(45,Math.round(cue.end*30)/30);
    const duration=Math.max(1/30,end-start),relative=(time:number)=>Math.max(0,Math.min(duration,time-start));
    return {id:`${runId}-caption-${i}`,kind:'caption',track:2,start,duration,sourceStart:0,text:cue.text.toUpperCase(),fontSize:78,fontFamily:'anton',color:'#FFFFFF',background:'transparent',x:.5,y:.81,animation:'none',textTemplate:{preset:'karaoke',highlightColor:'#C4B5FD',wordTimings:cue.words.map(word=>({start:relative(word.start),end:relative(word.end)}))},textStyle:{...DEFAULT_TEXT_APPEARANCE,strokeWidth:1.5,shadowBlur:5,shadowY:3,shadowColor:'#000000B3'}};
  });
  const zooms=[
    // “Businesses die of indigestion” in the two-person shot; focus on Hormozi.
    spokenZoom(`${runId}-zoom-businesses`,25.02,29.8,26.74,1.035,.82),
    // “Changing direction” in the close-up; preserve face and gesture framing.
    spokenZoom(`${runId}-zoom-direction`,39.4,44.9,42.94,1.025,.48),
  ];
  const shots=footage.clips.filter(clip=>clip.kind==='video').sort((a,b)=>a.start-b.start);
  for(const [i,shot] of shots.entries()){
    const sound=footage.clips.find(clip=>clip.id===shot.linkedClipId)!;
    steps.push({clips:[shot,sound],label:`Placing clip ${i+1} of ${shots.length}`,reply:'Building the sequence with the original footage and sound together.',delayMs:180});
    const end=shot.start+shot.duration;
    const additions=[...text.filter(clip=>clip.start>=shot.start-1e-7&&clip.start<end-1e-7),...zooms.filter(clip=>clip.start>=shot.start-1/30&&clip.start<end-1/30)];
    if(additions.length)steps.push({clips:additions,label:'Adding speech-timed subtitles',reply:'Highlighting each spoken word and accenting the two key spoken points.',delayMs:320});
  }
  const timeline=normalizeTimeline({...initial,clips:steps.flatMap(step=>step.clips)});
  return {initial,steps,timeline,assets:media.assets,summary:`${shots.length} clip blocks, ${text.length} animated subtitle phrases, and two subtle zooms are ready. The full conversation and original audio are preserved. Press play.`};
}
