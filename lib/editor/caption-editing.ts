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
  validateAppearance(source);
  const presetSource=source.captionPreset&&source.textTemplate?.preset==='karaoke'?source.textTemplate:undefined;
  const style=textStyle(source),patch={fontFamily:source.fontFamily??'space-grotesk' as const,fontSize:style.fontSize,color:templateTextProps(source,source.start,timeline.fps)?.color??style.color,background:style.background,x:style.x,y:style.y,blendMode:source.blendMode??'normal' as const,textStyle:resolvedTextAppearance(source),textGradient:source.textGradient?{...source.textGradient,offset:0}:undefined,transform:{...DEFAULT_TRANSFORM,...source.transform}};
  return {...timeline,clips:timeline.clips.map(clip=>{
    if(!selected.has(clip.id)||clip.id===source.id)return clip;
    // A preset caption lends its preset, as edited, with its word motion: each target keeps its own word timings.
    if(presetSource){
      const own=clip.textTemplate?.preset==='karaoke'?clip.textTemplate:undefined;
      return {...clip,...patch,captionPreset:{...source.captionPreset!},textTemplate:{preset:'karaoke' as const,duration:own?.duration??clip.duration,offset:own?.offset??0,...(own?.wordTimings?{wordTimings:own.wordTimings}:{}),...(presetSource.highlightColor?{highlightColor:presetSource.highlightColor}:{}),...(presetSource.karaokeStyle?{karaokeStyle:presetSource.karaokeStyle}:{})}};
    }
    // A plain look replaces a target's preset: its word styling would otherwise keep drawing over the copied look.
    return clip.captionPreset?{...clip,...patch,captionPreset:undefined,...(clip.textTemplate?.preset==='karaoke'?{textTemplate:undefined}:{})}:{...clip,...patch};
  })};
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
/** What retiming a caption did to a neighbouring caption on its track to make room. */
export type CaptionNeighbourChange={clipId:string;text:string;action:'trimmed'|'removed';from:{start:number;end:number};to?:{start:number;end:number};reason:string};
const captionWords=(text:string)=>text.toLocaleLowerCase('en-US').split(/\s+/).map(word=>word.replace(/[^\p{L}\p{N}']/gu,'')).filter(Boolean);
/** Whether every word of `inner` (as a multiset, ignoring case and punctuation) is in `outer`. */
function wordsInside(inner:string,outer:string){
  const pool=new Map<string,number>();for(const word of captionWords(outer))pool.set(word,(pool.get(word)??0)+1);
  const words=captionWords(inner);
  return words.length>0&&words.every(word=>{const left=pool.get(word)??0;if(!left)return false;pool.set(word,left-1);return true;});
}
/** Edit a caption's absolute range on project frames, preserving its original animation phase. An edge reaching less than
 *  a frame (or 40 ms) into a neighbouring caption stops at that caption (`snapped`). Otherwise neighbouring captions on
 *  its track make room: an overlapped edge is trimmed (a moved start keeps its animation phase), and a neighbour left with
 *  less than a frame, or covered, is removed only when all its words are in this caption's text. A neighbour that would
 *  lose words, or another kind of clip on the track, is never changed: the call is refused naming it. */
export function updateCaptionTiming(timeline:Timeline,clipId:string,changes:{start?:number;end?:number}):{timeline:Timeline;neighbours:CaptionNeighbourChange[];snapped?:{start?:number;end?:number}}{
  timeline=normalizeTimeline(timeline);const clip=caption(timeline,clipId);
  if(changes.start===undefined&&changes.end===undefined)throw new Error('Specify a caption start or end.');
  const requestedStart=changes.start??clip.start,requestedEnd=changes.end??clip.start+clip.duration;
  if(![requestedStart,requestedEnd].every(Number.isFinite)||requestedStart<0||requestedEnd<0)throw new Error('Caption times must be finite and nonnegative.');
  const frame=1/timeline.fps;
  let start=Math.round(requestedStart*timeline.fps)/timeline.fps,end=Math.round(requestedEnd*timeline.fps)/timeline.fps;
  if(end-start<frame-1e-7)throw new Error('A caption must last at least one frame.');
  // A caption edge that runs a sliver (under a frame, or 40 ms) into a neighbouring caption stops at it: the end meets the
  // next caption's start and the start meets the previous one's end, so a rounded time never refuses or trims a neighbour.
  const sliver=Math.max(frame,.04)+1e-7,snapped:{start?:number;end?:number}={};
  for(const other of timeline.clips){
    if(other.id===clip.id||other.kind!=='caption'||trackOf(other)!==trackOf(clip))continue;
    const otherEnd=other.start+other.duration;
    if(other.start>start&&other.start<end-1e-7&&end-other.start<=sliver&&otherEnd>end){end=other.start;snapped.end=Math.round(end*1000)/1000;}
    else if(otherEnd<end&&otherEnd>start+1e-7&&otherEnd-start<=sliver&&other.start<start){start=otherEnd;snapped.start=Math.round(start*1000)/1000;}
  }
  const duration=end-start;
  if(duration<frame-1e-7)throw new Error('A caption must last at least one frame.');
  const overlapping=timeline.clips.filter(other=>other.id!==clip.id&&other.kind!=='audio'&&other.kind!=='effect'&&trackOf(other)===trackOf(clip)&&other.start<end-1e-7&&start<other.start+other.duration-1e-7);
  const name=(other:Clip)=>`${other.kind==='caption'?'Caption':'Clip'} ${other.id}${other.text?` ${JSON.stringify(other.text.slice(0,60))}`:''} (${other.start.toFixed(2)}–${(other.start+other.duration).toFixed(2)} s)`;
  // Only captions make room; any other clip on the track is the caller's to move.
  const blocker=overlapping.find(other=>other.kind!=='caption');
  if(blocker)throw new Error(`The caption range overlaps another clip on its V track: ${name(blocker)}. Move that clip first, or keep this caption outside it.`);
  const text=clip.text??'',neighbours:CaptionNeighbourChange[]=[],replaced=new Map<string,Clip|null>();
  const round=(value:number)=>Math.round(value*1000)/1000;
  for(const other of overlapping){
    const otherEnd=other.start+other.duration,from={start:round(other.start),end:round(otherEnd)},said=wordsInside(other.text??'',text);
    // What is left of the neighbour before and after the new range.
    // A leftover shorter than a frame and a half is no caption: it counts as covered (the server refuses under one frame).
    const before=Math.max(0,start-other.start),after=Math.max(0,otherEnd-end),keep=frame*1.5;
    if(before>=keep&&after>=keep)throw new Error(`The new range sits inside ${name(other)}, which would have to be split. Retime that caption first, or choose a range that starts or ends outside it.`);
    if(before<keep&&after<keep||said&&Math.max(before,after)<other.duration/2){
      // Covered, or mostly covered by a caption that now says its words: it goes. Words this caption does not say never go.
      if(!said)throw new Error(`The new range covers ${name(other)}, and this caption's text does not include its words, so removing it would lose them. Put its words into this caption with editText first, or retime that caption.`);
      neighbours.push({clipId:other.id,text:other.text??'',action:'removed',from,reason:'its words are in the retimed caption'});replaced.set(other.id,null);continue;
    }
    if(before>=keep){
      // The neighbour runs into the new range from the left: its end comes back to the new start.
      const next={...other,duration:start-other.start};validateClipEffects(next);replaced.set(other.id,next);
      neighbours.push({clipId:other.id,text:other.text??'',action:'trimmed',from,to:{start:round(next.start),end:round(start)},reason:'its end overlapped the retimed caption'});
    }else{
      // From the right: its start moves to the new end, keeping its animation phase.
      const next={...other,...offsetClipMotion(other,end-other.start),start:end,duration:otherEnd-end};validateClipEffects(next);replaced.set(other.id,next);
      neighbours.push({clipId:other.id,text:other.text??'',action:'trimmed',from,to:{start:round(end),end:round(otherEnd)},reason:'its start overlapped the retimed caption'});
    }
  }
  const next={...clip,...offsetClipMotion(clip,start-clip.start),start,duration};validateClipEffects(next);
  return {timeline:{...timeline,clips:timeline.clips.flatMap(item=>item.id===clipId?[next]:replaced.has(item.id)?(replaced.get(item.id)?[replaced.get(item.id)!]:[]):[item])},neighbours,...(Object.keys(snapped).length?{snapped}:{})};
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
    // Saved timings keep their template clock; timings read now are measured from the clip's start, so the clock restarts there.
    const read=saved?undefined:captionWordTimings(timeline,clip,speech);
    const clock=saved?{duration:template!.duration??clip.duration,offset:template!.offset??0}:{duration:clip.duration,offset:0};
    const base:Clip={...clip,textTemplate:{preset:'karaoke',...clock,...(saved??read?{wordTimings:(saved??read)!}:{})}};
    const next={...base,...captionPresetPatch(base,id,tuning)};
    validateAppearance(next);return next;
  })};
}

/** Captions among the targets (all captions without targets) with no saved word timings. */
export function untimedCaptions(timeline:Timeline,targetIds?:readonly string[]):Clip[]{
  return timeline.clips.filter(clip=>clip.kind==='caption'&&(!targetIds||targetIds.includes(clip.id))&&!(clip.textTemplate?.preset==='karaoke'&&clip.textTemplate.wordTimings));
}
/** The footage assets whose transcripts can time those captions: video or sound under one of them. */
export function captionTimingSources(timeline:Timeline,targetIds?:readonly string[]):string[]{
  const untimed=untimedCaptions(timeline,targetIds);
  return [...new Set(timeline.clips.filter(footage=>footage.assetId&&(footage.kind==='video'||footage.kind==='audio')&&untimed.some(clip=>footage.start<clip.start+clip.duration&&clip.start<footage.start+footage.duration)).map(footage=>footage.assetId!))];
}
