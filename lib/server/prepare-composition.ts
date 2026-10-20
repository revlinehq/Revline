import { copyFile, writeFile,link,access } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { MediaAsset, Timeline } from '../editor/types';
import { TEXT_FONTS } from '../editor/text-fonts';
import { isTransitionClip } from '../editor/clip-transitions';
import { generateComposition } from '../editor/composition';
import { downloadOwnedMedia,probeMedia } from '../media-analysis/io';
import { AnalysisError } from '../media-analysis/errors';
import { prepareRenderAudioSource } from './prepare-render-audio';
import { mediaSourceCacheIdentity, reuseMediaFile } from './media-file-cache';
import { sourceEndOf } from '../editor/playback-rate';

type CompositionAsset=MediaAsset&{size:number;ownerId?:string;projectId?:string;contentType?:string;r2Key?:string;storageId?:string};

/** Shared trusted assets/runtime preparation for MP4 export and rendered review. */
export async function prepareComposition(directory:string,timeline:Timeline,assets:CompositionAsset[],convexUrl:string,signal:AbortSignal) {
  const assetUrls:Record<string,string>={},audioSourceOffsets:Record<string,number>={};
  const audioWindows=new Map<string,{start:number;end:number}>();
  for(const clip of timeline.clips)if(clip.kind==='audio'&&clip.assetId&&(clip.volume??1)>0){
    const previous=audioWindows.get(clip.assetId);
    audioWindows.set(clip.assetId,{start:Math.floor(Math.min(previous?.start??clip.sourceStart,clip.sourceStart)*48000)/48000,end:Math.ceil(Math.max(previous?.end??0,sourceEndOf(clip))*48000)/48000});
  }
  for(const [index,asset] of assets.entries()) {
    const audioWindow=audioWindows.get(asset._id);
    if(asset.kind==='audio'&&!audioWindow)continue;
    if(!asset.url)throw new AnalysisError('Composition source media is unavailable.',400);
    const sourceExtension=extname(asset.fileName).toLowerCase();
    const extension=/^\.(mp4|mov|webm|m4v|mp3|wav|m4a|ogg|flac|aac|aiff|png|jpg|jpeg|webp|gif|avif)$/.test(sourceExtension)?sourceExtension:asset.kind==='video'?'.mp4':asset.kind==='audio'?'.audio':'.image';
    const name=`asset-${index}${extension}`;
    // Reuse only immutable media identified by a fresh, authorized task snapshot.
    // The existing bounded cache isolates backend, owner and project and keeps
    // active files alive through hard links when an older entry is evicted.
    const identity=asset.projectId&&asset.contentType?mediaSourceCacheIdentity(convexUrl,asset.projectId,{...asset,contentType:asset.contentType}):undefined;
    await reuseMediaFile({identity,variant:'source-v1',target:join(directory,name),signal,expectedBytes:asset.size},()=>downloadOwnedMedia(asset.url!,join(directory,name),new URL(convexUrl).origin,asset.size,signal));
    let decoded=false;
    if(asset.kind==='audio'){
      const output=join(directory,`asset-${index}-decoded.wav`);
      const reused=await reuseMediaFile({identity,variant:`export-pcm48k-s16-window-v2:${audioWindow!.start}:${audioWindow!.end}`,target:output,signal,maxBytes:128*1024*1024},async()=>{decoded=(await prepareRenderAudioSource(join(directory,name),output,signal,audioWindow)).decoded;});
      decoded||=reused;
      if(decoded)audioSourceOffsets[asset._id]=audioWindow!.start;
    }
    assetUrls[asset._id]=decoded?`./asset-${index}-decoded.wav`:`./${name}`;
  }
  await copyFile(join(process.cwd(),'public/vendor/gsap.min.js'),join(directory,'gsap.min.js'));
  await copyFile(join(process.cwd(),'public/vendor/visual-effects.js'),join(directory,'visual-effects.js'));
  if(timeline.clips.some(clip=>clip.kind==='graphic'||clip.kind==='caption'||isTransitionClip(clip)))await copyFile(join(process.cwd(),'public/vendor/remotion-runtime.js'),join(directory,'remotion-runtime.js'));
  for(const font of TEXT_FONTS)await copyFile(join(process.cwd(),'public/fonts',font.fileName),join(directory,font.fileName));
  return {assetUrls,audioSourceOffsets};
}
export async function linkCompositionResources(root:string,directory:string,assetUrls:Record<string,string>){
  for(const name of [...Object.values(assetUrls).map(url=>url.slice(2)),'gsap.min.js','visual-effects.js','remotion-runtime.js',...TEXT_FONTS.map(font=>font.fileName)]){
    try{await access(join(root,name));}catch{continue;}
    await link(join(root,name),join(directory,name));
  }
}
export async function writeComposition(directory:string,timeline:Timeline,assets:MediaAsset[],assetUrls:Record<string,string>,resolution:720|1080,fps:24|30|60,prefix='./',signal:AbortSignal=AbortSignal.timeout(30_000),audioSourceOffsets:Record<string,number>={}) {
  const audibleVideo=new Set(timeline.clips.filter(clip=>clip.kind==='video'&&clip.volume!==0).map(clip=>clip.assetId));
  const silent=new Set<string>();
  for(const asset of assets)if(asset.kind==='video'&&audibleVideo.has(asset._id)){
    const source=assetUrls[asset._id];
    if(!source?.startsWith('./'))throw new AnalysisError('Composition source media is unavailable.',400);
    if(!(await probeMedia(join(directory,source.slice(2)),signal)).hasAudio)silent.add(asset._id);
  }
  // An unmuted video is also authored as sound by the native producer. Probe
  // the downloaded source rather than assuming every video has an audio stream.
  const rendered={...timeline,clips:timeline.clips.map(clip=>{
    if(clip.kind==='video'&&clip.assetId&&silent.has(clip.assetId))return {...clip,volume:0};
    const offset=clip.kind==='audio'&&clip.assetId?audioSourceOffsets[clip.assetId]:undefined;
    return offset?{...clip,sourceStart:Math.max(0,clip.sourceStart-offset)}:clip;
  })};
  await writeFile(join(directory,'index.html'),generateComposition(rendered,assets,{resolution,fps,gsapUrl:prefix+'gsap.min.js',visualEffectsUrl:prefix+'visual-effects.js',remotionRuntimeUrl:prefix+'remotion-runtime.js',fontUrl:prefix+'space-grotesk-latin.woff2',fontUrls:Object.fromEntries(TEXT_FONTS.map(font=>[font.id,prefix+font.fileName])),assetUrls:Object.fromEntries(Object.entries(assetUrls).map(([id,url])=>[id,prefix+url.slice(2)]))}));
}
/** Keep original times/animation phases and source holds for transitions in the window. */
export function reviewWindowTimeline(timeline:Timeline,start:number,end:number):Timeline {
  const keep=new Set(timeline.clips.filter(clip=>clip.kind!=='audio'&&clip.start<end&&clip.start+clip.duration>start).map(clip=>clip.id));
  for(const clip of timeline.clips)if(keep.has(clip.id)&&clip.transition){keep.add(clip.transition.fromClipId);keep.add(clip.transition.toClipId);}
  return {...timeline,clips:timeline.clips.filter(clip=>keep.has(clip.id))};
}
