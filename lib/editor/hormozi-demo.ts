import captions from './hormozi-demo-captions.json';
import { NEUTRAL_MOTION } from './clip-effects';
import { DEFAULT_TEXT_APPEARANCE } from './text-style';
import { addMediaClip } from './operations';
import { EMPTY_SCRIPTED_DEMO, scriptedDemoMedia, type DemoBuildStep } from './scripted-demo';
import { normalizeTimeline, type Clip, type MediaAsset } from './types';

/** The recording take uses a fixed source; composer uploads are only its trigger. */
// Modern Wisdom #610, https://www.youtube.com/watch?v=JuNOFW-oVn8, 19:07–19:52.
// Caption timings were transcribed locally with Whisper; no provider is called at runtime.
export const HORMOZI_DEMO_ASSET: MediaAsset = { _id: 'hormozi-recording-source', kind: 'video', fileName: 'Hormozi-distractions-45s.mp4', url: '/demo/hormozi-distractions.mp4', duration: 45, width: 1280, height: 720 };

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
  const footage=addMediaClip(initial,{...HORMOZI_DEMO_ASSET,audioAssetId:media.audioByVideo.get(HORMOZI_DEMO_ASSET._id)},`${runId}-video`);
  const steps:DemoBuildStep[]=[{clips:footage.clips,label:'Placing footage and sound',reply:'I’ll add synchronized subtitles and two gentle zooms on the key spoken points.',delayMs:350}];
  const text:Clip[]=captions.map((cue,i)=>{
    const start=Math.round(cue.start*30)/30,end=Math.min(45,Math.round(cue.end*30)/30);
    return {id:`${runId}-caption-${i}`,kind:'caption',track:2,start,duration:Math.max(1/30,end-start),sourceStart:0,text:cue.text,fontSize:62,fontFamily:'space-grotesk',color:'#FFFFFF',background:'transparent',x:.5,y:.83,animation:'none',textStyle:{...DEFAULT_TEXT_APPEARANCE,strokeWidth:2.5,shadowBlur:8,shadowY:2,shadowColor:'#000000CC'}};
  });
  for(let i=0;i<text.length;i+=3)steps.push({clips:text.slice(i,i+3),label:'Adding synchronized subtitles',reply:'Placing the spoken words on the timeline without changing the conversation.',delayMs:220});
  steps.push({clips:[
    // “Businesses die of indigestion” in the two-person shot; focus on Hormozi.
    spokenZoom(`${runId}-zoom-businesses`,25.02,29.8,26.74,1.035,.82),
    // “Changing direction” in the close-up; preserve face and gesture framing.
    spokenZoom(`${runId}-zoom-direction`,39.4,44.9,42.94,1.025,.48),
  ],label:'Accenting the key spoken points',reply:'Adding two small, eased zooms on the business lesson and changing-direction takeaway.',delayMs:500});
  const timeline=normalizeTimeline({...initial,clips:steps.flatMap(step=>step.clips)});
  return {initial,steps,timeline,assets:media.assets,summary:`${text.length} synchronized subtitle phrases and two subtle zooms are ready. The full conversation and original audio are preserved. Press play.`};
}
