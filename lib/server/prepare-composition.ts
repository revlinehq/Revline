import { preparePixelTrackFiles, localPixelTrackFiles } from './pixel-track-files';
import { copyFile, writeFile,link,access,readdir } from 'node:fs/promises';
import { resolvedAudioTimeline } from '../editor/audio-normalization';
import { extname, join } from 'node:path';
import type { MediaAsset, Timeline } from '../editor/types';
import { TEXT_FONTS } from '../editor/text-fonts';
import { isTransitionClip } from '../editor/clip-transitions';
import { isReactScene } from '../editor/scene-modules';
import { generateComposition, type ExportResolution } from '../editor/composition';
import { downloadOwnedMedia,probeMedia } from '../media-analysis/io';
import { AnalysisError } from '../media-analysis/errors';
import { prepareRenderAudioSource } from './prepare-render-audio';
import { mediaSourceCacheIdentity, reuseMediaFile } from './media-file-cache';
import { sourceEndOf, sourceTimeAt, timelineTimeAtSource } from '../editor/playback-rate';
import { offsetClipMotion } from '../editor/clip-effects';
import { forEachLimited } from './run-limited';
import { ownedMediaUrl } from './owned-media';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

type CompositionAsset=MediaAsset&{size:number;ownerId?:string;projectId?:string;contentType?:string;r2Key?:string;storageId?:string};

/** Shared trusted assets/runtime preparation for MP4 export and rendered review. */
export async function prepareComposition(directory:string,timeline:Timeline,assets:CompositionAsset[],convexUrl:string,signal:AbortSignal,referenceTimelines:Timeline[] = [],windows?:{start:number;end:number}[]) {
  timeline=resolvedAudioTimeline(timeline);
  const assetUrls:Record<string,string>={},audioSourceOffsets:Record<string,number>={};
  const audioWindows=new Map<string,{start:number;end:number}>();
  for(const clip of timeline.clips)if(clip.kind==='audio'&&clip.assetId&&(clip.volume??1)>0){
    const previous=audioWindows.get(clip.assetId);
    audioWindows.set(clip.assetId,{start:Math.floor(Math.min(previous?.start??clip.sourceStart,clip.sourceStart)*48000)/48000,end:Math.ceil(Math.max(previous?.end??0,sourceEndOf(clip))*48000)/48000});
  }
  const needed=[...assets.entries()].filter(([,asset])=>asset.kind!=='audio'||audioWindows.has(asset._id));
  if(needed.some(([,asset])=>!asset.url))throw new AnalysisError('Composition source media is unavailable.',400);
  const prepared=new Map<number,{url:string;offset?:number}>();
  // Sources are independent; a few concurrent downloads/decodes stay well
  // inside the worker's bandwidth, CPU and disk budget.
  await forEachLimited(needed,3,async([index,asset],stop)=>{
    const sourceSignal=AbortSignal.any([signal,stop]);
    const audioWindow=audioWindows.get(asset._id);
    if(windows && (asset.kind==='video'||asset.kind==='audio')){
      const clips=[timeline,...referenceTimelines].flatMap(t=>t.clips).filter(c=>c.assetId===asset._id);
      if(clips.length){
        const spans=clips.flatMap(c=>windows.filter(w=>c.start<w.end&&c.start+c.duration>w.start).map(w=>({start:sourceTimeAt(c,Math.max(c.start,w.start)),end:sourceTimeAt(c,Math.min(c.start+c.duration,w.end))})));
        if(!spans.length)return;
        const start=Math.max(0,Math.min(...spans.map(s=>s.start))),end=Math.max(...spans.map(s=>s.end));
        const source=ownedMediaUrl(asset.url!,new URL(convexUrl).origin);
        if(asset.kind==='audio'){
          const name=`asset-${index}-decoded.wav`;
          await prepareRenderAudioSource(source,join(directory,name),sourceSignal,{start,end});
          prepared.set(index,{url:`./${name}`,offset:start});return;
        }
        const alpha=asset.contentType==='video/webm'||!!asset.cutoutOf,name=`asset-${index}-window.${alpha?'webm':'mp4'}`;
        const codec=alpha?(await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name','-of','csv=p=0',source],{signal:sourceSignal})).stdout.trim():'';
        const decoder=codec==='vp8'?'libvpx':codec==='vp9'?'libvpx-vp9':undefined;
        await run('ffmpeg',['-v','error','-threads','2',...(decoder?['-c:v',decoder]:[]),'-ss',String(start),'-i',source,'-t',String(end-start),'-map','0:v:0','-map','0:a:0?',...(alpha?['-c:v','libvpx-vp9','-pix_fmt','yuva420p','-auto-alt-ref','0','-b:v','0','-crf','18','-deadline','realtime']:['-c:v','libx264','-preset','veryfast','-crf','14','-pix_fmt','yuv420p','-movflags','+faststart']),'-threads','2','-c:a',alpha?'libopus':'aac','-y',join(directory,name)],{signal:sourceSignal,maxBuffer:1024*1024});
        prepared.set(index,{url:`./${name}`,offset:start});return;
      }
    }
    const sourceExtension=extname(asset.fileName).toLowerCase();
    const extension=/^\.(mp4|mov|webm|m4v|mp3|wav|m4a|ogg|flac|aac|aiff|png|jpg|jpeg|webp|gif|avif)$/.test(sourceExtension)?sourceExtension:asset.kind==='video'?'.mp4':asset.kind==='audio'?'.audio':'.image';
    const name=`asset-${index}${extension}`;
    // Reuse only immutable media identified by a fresh, authorized task snapshot.
    // The existing bounded cache isolates backend, owner and project and keeps
    // active files alive through hard links when an older entry is evicted.
    const identity=asset.projectId&&asset.contentType?mediaSourceCacheIdentity(convexUrl,asset.projectId,{...asset,contentType:asset.contentType}):undefined;
    await reuseMediaFile({identity,variant:'source-v1',target:join(directory,name),signal:sourceSignal,expectedBytes:asset.size},()=>downloadOwnedMedia(asset.url!,join(directory,name),new URL(convexUrl).origin,asset.size,sourceSignal));
    let decoded=false;
    if(asset.kind==='audio'){
      const output=join(directory,`asset-${index}-decoded.wav`);
      const reused=await reuseMediaFile({identity,variant:`export-pcm48k-s16-window-v2:${audioWindow!.start}:${audioWindow!.end}`,target:output,signal:sourceSignal,maxBytes:128*1024*1024},async()=>{decoded=(await prepareRenderAudioSource(join(directory,name),output,sourceSignal,audioWindow)).decoded;});
      decoded||=reused;
    }
    prepared.set(index,decoded?{url:`./asset-${index}-decoded.wav`,offset:audioWindow!.start}:{url:`./${name}`});
  });
  for(const [index,asset] of needed){
    const value=prepared.get(index);if(!value)continue;
    const {url,offset}=value;
    assetUrls[asset._id]=url;
    if(offset!==undefined)audioSourceOffsets[asset._id]=offset;
  }
  await preparePixelTrackFiles(directory, { ...timeline, clips: [...timeline.clips, ...referenceTimelines.flatMap(reference => reference.clips)] }, convexUrl, signal);
  await copyFile(join(process.cwd(),'public/vendor/gsap.min.js'),join(directory,'gsap.min.js'));
  await copyFile(join(process.cwd(),'public/vendor/visual-effects.js'),join(directory,'visual-effects.js'));
  if(timeline.clips.some(clip=>clip.kind==='graphic'||clip.kind==='caption'||isTransitionClip(clip)))await copyFile(join(process.cwd(),'public/vendor/remotion-runtime.js'),join(directory,'remotion-runtime.js'));
  if(timeline.clips.some(clip=>clip.kind==='scene')){await copyFile(join(process.cwd(),'public/vendor/scene-runtime.js'),join(directory,'scene-runtime.js'));await copyFile(join(process.cwd(),'public/vendor/lucide-icons.json'),join(directory,'lucide-icons.json'));if(timeline.clips.some(clip=>clip.kind==='scene'&&isReactScene(clip.scene?.code??'')))await copyFile(join(process.cwd(),'public/vendor/scene-react.js'),join(directory,'scene-react.js'));}
  for(const font of TEXT_FONTS)await copyFile(join(process.cwd(),'public/fonts',font.fileName),join(directory,font.fileName));
  // Brand-kit fonts and screens render from local copies, like media: the renderer never depends on the network.
  const brandFonts=[...new Set(timeline.clips.flatMap(clip=>clip.kind==='scene'?[...clip.scene?.brand?.fonts.map(font=>font.url)??[],...clip.scene?.brand?.screens?.map(screen=>screen.url)??[]]:[]))];
  for(const [index,url] of brandFonts.entries()){
    try{
      const response=await fetch(url,{signal});
      if(!response.ok)continue;
      const type=response.headers.get('content-type')??'',name=`brand-file-${index}.${/woff2/.test(type)?'woff2':/woff/.test(type)?'woff':/otf|opentype/.test(type)?'otf':/png/.test(type)?'png':/jpe?g/.test(type)?'jpg':/webp/.test(type)?'webp':'ttf'}`;
      await writeFile(join(directory,name),Buffer.from(await response.arrayBuffer()));
      assetUrls[url]=`./${name}`;
    }catch(error){if(signal.aborted)throw error;}
  }
  return {assetUrls,audioSourceOffsets};
}
export async function linkCompositionResources(root:string,directory:string,assetUrls:Record<string,string>){
  for(const name of [...Object.values(assetUrls).map(url=>url.slice(2)),'gsap.min.js','visual-effects.js','remotion-runtime.js','scene-runtime.js','scene-react.js','lucide-icons.json',...TEXT_FONTS.map(font=>font.fileName),...(await readdir(root)).filter(name=>/^pixel-track-.+\.json$/.test(name))]){
    try{await access(join(root,name));}catch{continue;}
    await link(join(root,name),join(directory,name));
  }
}
export async function writeComposition(directory:string,timeline:Timeline,assets:MediaAsset[],assetUrls:Record<string,string>,resolution:ExportResolution,fps:24|30|60,prefix='./',signal:AbortSignal=AbortSignal.timeout(30_000),audioSourceOffsets:Record<string,number>={}) {
  timeline=resolvedAudioTimeline(timeline);
  timeline={...timeline,clips:timeline.clips.filter(clip=>!clip.assetId||assetUrls[clip.assetId])};
  const audibleVideo=new Set(timeline.clips.filter(clip=>clip.kind==='video'&&clip.volume!==0).map(clip=>clip.assetId));
  const silent=new Set<string>();
  const audible=assets.filter(asset=>asset.kind==='video'&&audibleVideo.has(asset._id));
  if(audible.some(asset=>!assetUrls[asset._id]?.startsWith('./')))throw new AnalysisError('Composition source media is unavailable.',400);
  await forEachLimited(audible,4,async(asset,stop)=>{
    if(!(await probeMedia(join(directory,assetUrls[asset._id].slice(2)),AbortSignal.any([signal,stop]))).hasAudio)silent.add(asset._id);
  });
  // An unmuted video is also authored as sound by the native producer. Probe
  // the downloaded source rather than assuming every video has an audio stream.
  const rendered={...timeline,clips:timeline.clips.map(clip=>{
    if(clip.kind==='video'&&clip.assetId&&silent.has(clip.assetId))clip={...clip,volume:0};
    const offset=clip.assetId?audioSourceOffsets[clip.assetId]:undefined;
    if(offset!==undefined&&clip.sourceStart<offset){
      const delta=timelineTimeAtSource(clip,offset)-clip.start;
      return {...clip,...offsetClipMotion(clip,delta),start:clip.start+delta,duration:Math.max(0,clip.duration-delta),sourceStart:0};
    }
    return offset?{...clip,sourceStart:Math.max(0,clip.sourceStart-offset)}:clip;
  })};
  // HyperFrames dedupes a video's sound by comparing the authored src with the
  // browser's server-relative src ("asset-0.mp4"). A "./" prefix never matches,
  // so it mixed an extra unity-gain, 1x copy of each source's first audible clip.
  // Author media in that same form so every clip's sound is mixed exactly once.
  const mediaSrc=(url:string)=>(prefix+url.slice(2)).replace(/^\.\//,'');
  await writeFile(join(directory,'index.html'),generateComposition(rendered,assets,{pixelTrackFiles:await localPixelTrackFiles(directory),resolution,fps,gsapUrl:prefix+'gsap.min.js',visualEffectsUrl:prefix+'visual-effects.js',remotionRuntimeUrl:prefix+'remotion-runtime.js',sceneRuntimeUrl:prefix+'scene-runtime.js',fontUrl:prefix+'space-grotesk-latin.woff2',fontUrls:Object.fromEntries(TEXT_FONTS.map(font=>[font.id,prefix+font.fileName])),assetUrls:Object.fromEntries(Object.entries(assetUrls).map(([id,url])=>[id,mediaSrc(url)]))}));
}
/** Keep original times/animation phases and source holds for transitions in the window. */
export function reviewWindowTimeline(timeline:Timeline,start:number,end:number):Timeline {
  const keep=new Set(timeline.clips.filter(clip=>clip.kind!=='audio'&&clip.start<end&&clip.start+clip.duration>start).map(clip=>clip.id));
  for(const clip of timeline.clips)if(keep.has(clip.id)&&clip.transition){keep.add(clip.transition.fromClipId);keep.add(clip.transition.toClipId);}
  return {...timeline,clips:timeline.clips.filter(clip=>keep.has(clip.id))};
}
