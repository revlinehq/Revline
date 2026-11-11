import { validateClipEffects,offsetClipMotion } from './clip-effects';
import { DEFAULT_TRANSFORM,normalizeTimeline,trackOf,type Clip,type Timeline } from './types';
import { resolvedTextAppearance,textStyle,type TextAppearance } from './text-style';
import { templateTextProps, type WordTiming } from './text-templates';
import { captionPresetPatch, type CaptionPresetId } from './caption-presets';
import { wordInSource } from './transcript-captions';
import { sourceEndOf, timelineTimeAtSource } from './playback-rate';
import type { Transcript } from '../media-analysis/transcript';

export type CaptionStyleChanges=Partial<Pick<Clip,'fontSize'|'fontFamily'|'color'|'background'|'x'|'y'|'blendMode'>>&{rotation?:number;textStyle?:Partial<TextAppearance>;textCase?:'sentence'|'upper'|'lower'};
function caption(timeline:Timeline,id:string){const clip=timeline.clips.find(item=>item.id===id);if(!clip||clip.kind!=='caption')throw new Error('Choose an existing caption clip.');return clip}
function targets(timeline:Timeline,ids?:string[]){
  if(ids){if(!ids.length)throw new Error('Choose at least one caption.');for(const id of ids)caption(timeline,id);return new Set(ids)}
  const selected=new Set(timeline.clips.filter(clip=>clip.kind==='caption').map(clip=>clip.id));
  if(!selected.size)throw new Error('This timeline has no saved captions.');return selected;
}
function validateAppearance(clip:Clip){
  validateClipEffects(clip);
  if(clip.fontSize!==undefined&&(!Number.isFinite(clip.fontSize)||clip.fontSize<8||clip.fontSize>300))throw new Error('Caption font size must be between 8 and 300.');
  for(const key of ['x','y'] as const)if(clip[key]!==undefined&&(!Number.isFinite(clip[key])||clip[key]!<0||clip[key]!>1))throw new Error('Caption position must be between 0 and 1.');
  for(const value of [clip.color,clip.background])if(value!==undefined&&!/^(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i.test(value))throw new Error('Caption colors must use hex or transparent.');
  if(clip.transform&&(!Number.isFinite(clip.transform.rotation)||Math.abs(clip.transform.rotation)>360))throw new Error('Caption rotation must be between -360 and 360.');
}
/** Copy appearance only. Each target keeps its own words, timing and animation. */
export function applyCaptionStyle(timeline:Timeline,sourceClipId:string,targetIds?:string[]):Timeline{
  const source=caption(timeline,sourceClipId),selected=targets(timeline,targetIds);
  // A caption in a preset lends the preset, word motion included.
  if(source.captionPreset)return applyCaptionPreset(timeline,source.captionPreset.id,[...selected],new Map(),{popScale:source.captionPreset.popScale,popDuration:source.captionPreset.popDuration});
  validateAppearance(source);
  const style=textStyle(source),patch={fontFamily:source.fontFamily??'space-grotesk' as const,fontSize:style.fontSize,color:templateTextProps(source,source.start,timeline.fps)?.color??style.color,background:style.background,x:style.x,y:style.y,blendMode:source.blendMode??'normal' as const,textStyle:resolvedTextAppearance(source),textGradient:source.textGradient?{...source.textGradient,offset:0}:undefined,transform:{...DEFAULT_TRANSFORM,...source.transform}};
  return {...timeline,clips:timeline.clips.map(clip=>selected.has(clip.id)?{...clip,...patch}:clip)};
}
/** Patch requested appearance fields only; animation changes are a separate explicit action. */
export function patchCaptionStyles(timeline:Timeline,changes:CaptionStyleChanges,targetIds?:string[]):Timeline{
  const selected=targets(timeline,targetIds);
  return patchSelectedTextStyles(timeline,changes,selected);
}
/** Explicit IDs can include titles. The implicit caption action stays caption-only. */
export function patchTextStyles(timeline:Timeline,changes:CaptionStyleChanges,targetIds:string[]):Timeline{
  if(!targetIds.length)throw new Error('Choose at least one text clip.');
  for(const id of targetIds){const clip=timeline.clips.find(item=>item.id===id);if(!clip||!['caption','graphic'].includes(clip.kind))throw new Error('Choose caption or text graphic clips only.');}
  return patchSelectedTextStyles(timeline,changes,new Set(targetIds));
}
function patchSelectedTextStyles(timeline:Timeline,changes:CaptionStyleChanges,selected:Set<string>):Timeline{
  if(!Object.values(changes).some(value=>value!==undefined))throw new Error('Specify a caption style control.');
  const {rotation,textStyle,textCase,...appearance}=changes;
  return {...timeline,clips:timeline.clips.map(clip=>{
    if(!selected.has(clip.id))return clip;
    const caseText=textCase===undefined?{}:{text:convertTextCase(clip.text??'',textCase)};
    const patch={...appearance,...caseText,...(appearance.color!==undefined?{textGradient:undefined}:{}),...(rotation!==undefined?{transform:{...DEFAULT_TRANSFORM,...clip.transform,rotation}}:{}),...(textStyle?{textStyle:{...resolvedTextAppearance(clip),...textStyle}}:{})};
    const next={...clip,...patch};validateAppearance(next);return next;
  })};
}
function convertTextCase(text:string,mode:NonNullable<CaptionStyleChanges['textCase']>){
  if(mode==='upper')return text.toLocaleUpperCase('en-US');
  const lower=text.toLocaleLowerCase('en-US');
  return mode==='lower'?lower:lower.split('\n').map(line=>line.replace(/^(\P{L}*)(\p{L})/u,(_,prefix:string,letter:string)=>prefix+letter.toLocaleUpperCase('en-US'))).join('\n');
}
/** Edit a caption's absolute range on project frames, preserving its original animation phase. */
export function updateCaptionTiming(timeline:Timeline,clipId:string,changes:{start?:number;end?:number}):Timeline{
  timeline=normalizeTimeline(timeline);const clip=caption(timeline,clipId);
  if(changes.start===undefined&&changes.end===undefined)throw new Error('Specify a caption start or end.');
  const requestedStart=changes.start??clip.start,requestedEnd=changes.end??clip.start+clip.duration;
  if(![requestedStart,requestedEnd].every(Number.isFinite)||requestedStart<0||requestedEnd<0)throw new Error('Caption times must be finite and nonnegative.');
  const start=Math.round(requestedStart*timeline.fps)/timeline.fps,end=Math.round(requestedEnd*timeline.fps)/timeline.fps,duration=end-start;
  if(duration<1/timeline.fps-1e-7)throw new Error('A caption must last at least one frame.');
  const blocker=timeline.clips.find(other=>other.id!==clip.id&&other.kind!=='audio'&&other.kind!=='effect'&&trackOf(other)===trackOf(clip)&&other.start<end-1e-7&&start<other.start+other.duration-1e-7);
  // Name the neighbour and its range: the fix is to retime it first, and the caller cannot guess which clip it is.
  if(blocker)throw new Error(`The caption range overlaps another clip on its V track. ${blocker.kind==='caption'?'Caption':'Clip'} ${blocker.id}${blocker.text?` ${JSON.stringify(blocker.text.slice(0,60))}`:''} occupies ${blocker.start.toFixed(2)}–${(blocker.start+blocker.duration).toFixed(2)} s. Retime that clip first, or keep this caption outside it.`);
  const next={...clip,...offsetClipMotion(clip,start-clip.start),start,duration};validateClipEffects(next);
  return {...timeline,clips:timeline.clips.map(item=>item.id===clipId?next:item)};
}

/** Saved speech per source asset, as `captionSpeech` returns it. */
export type CaptionSpeechSources=ReadonlyMap<string,{transcript:Transcript;edges?:number[]}>;
/** Each word's spoken time within a caption that has none saved, read from the transcript of the footage beneath it.
 *  Undefined when the spoken words there do not match the caption's words one for one (edited or hand-written text):
 *  the preset then spreads its words evenly over the caption. */
export function captionWordTimings(timeline:Timeline,clip:Clip,speech:CaptionSpeechSources):WordTiming[]|undefined{
  const tokens=(clip.text??'').trim().split(/\s+/).filter(Boolean),end=clip.start+clip.duration,frame=1/timeline.fps;
  if(!tokens.length)return undefined;
  const spoken:{start:number;end:number}[]=[];
  for(const footage of timeline.clips){
    if(!footage.assetId||!(footage.kind==='video'&&!footage.audioSeparated||footage.kind==='audio')||footage.start>=end||footage.start+footage.duration<=clip.start)continue;
    const source=speech.get(footage.assetId);if(!source)continue;
    const sourceEnd=sourceEndOf(footage),edges=source.edges?.length===source.transcript.words.length*2?source.edges:undefined;
    source.transcript.words.forEach((word,index)=>{
      if(!word.text.trim()||!wordInSource(word,footage.sourceStart,sourceEnd,edges&&{start:edges[index*2],end:edges[index*2+1]}))return;
      const at=timelineTimeAtSource(footage,word.start),to=timelineTimeAtSource(footage,word.end);
      if(at<clip.start-frame||at>=end)return;
      for(const _ of word.text.trim().split(/\s+/))spoken.push({start:at,end:to});
    });
  }
  spoken.sort((a,b)=>a.start-b.start);
  if(spoken.length!==tokens.length)return undefined;
  let previous=0;
  return spoken.map(word=>{const start=Math.min(clip.duration,Math.max(previous,word.start-clip.start)),stop=Math.min(clip.duration,Math.max(start,word.end-clip.start));previous=stop;return {start,end:stop};});
}
/** Apply a caption preset's whole look and word motion to every caption, or exact targets. Words, timing and position
 *  stay; a caption without word timings gets them from `speech` when its words match the transcript. */
export function applyCaptionPreset(timeline:Timeline,id:CaptionPresetId,targetIds?:string[],speech:CaptionSpeechSources=new Map(),tuning:{popScale?:number;popDuration?:number}={}):Timeline{
  const selected=targets(timeline,targetIds);
  return {...timeline,clips:timeline.clips.map(clip=>{
    if(!selected.has(clip.id))return clip;
    const template=clip.textTemplate?.preset==='karaoke'?clip.textTemplate:undefined,saved=template?.wordTimings;
    const timings=saved??captionWordTimings(timeline,clip,speech);
    // Timings are kept only where they belong to these words; another template's frozen timing is dropped.
    const base:Clip={...clip,textTemplate:{preset:'karaoke',duration:template?.duration??clip.duration,offset:template?.offset??0,...(timings?{wordTimings:timings}:{})}};
    const next={...base,...captionPresetPatch(base,id,tuning)};
    validateAppearance(next);return next;
  })};
}
