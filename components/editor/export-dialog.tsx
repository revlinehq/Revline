'use client';
import { userError } from '@/lib/user-error';
import { MAX_EXPORT_LABEL, MAX_EXPORT_SECONDS } from '@/lib/editor/limits';
import { useState, useEffect, useRef } from 'react';
import { Download, LoaderCircle, Film, RotateCcw, Square } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from './primitives';
import { formatTime, timelineDuration, type Timeline } from '@/lib/editor/types';
import { ProcessingStatus } from './processing-status';
/** A queued export this old most likely has no renderer to pick it up. */
const SLOW_QUEUE_MS=2*60_000;
export type ExportSettings={resolution:720|1080|2160;fps:24|30|60;quality:'standard'|'high';clipId?:string};
export type ExportState={status:'queued'|'rendering'|'completed'|'failed'|'cancelled';progress?:number;url?:string|null;error?:string|null;current?:boolean;sourceClipId?:string;requestId?:string;createdAt?:number;resolution?:number;fps?:number;quality?:string}|null;
export function ExportDialog({open,onOpenChange,title,timeline,coverUrl,onExport,onCancel,onDownload,state,demo,clipOnly=false,ultra=false}: {ultra?:boolean;open:boolean;onOpenChange:(v:boolean)=>void;title:string;timeline:Timeline;coverUrl?:string|null;onExport:(settings:ExportSettings)=>Promise<void>;onCancel?:(jobId:string)=>Promise<void>;onDownload?:(jobId:string)=>Promise<void>;state:ExportState;demo:boolean;clipOnly?:boolean}) {
  const [resolution,setResolution]=useState<720|1080|2160>(1080);const [fps,setFps]=useState<24|30|60>(timeline.fps===24||timeline.fps===60?timeline.fps:30);const [quality,setQuality]=useState<'standard'|'high'>('standard');const [starting,setStarting]=useState(false);const [error,setError]=useState('');const working=starting||state?.status==='queued'||state?.status==='rendering';
  const activeJob=state?.status==='queued'||state?.status==='rendering'?state:null;
  const [stopping,setStopping]=useState(false);const [downloading,setDownloading]=useState(false);
  useEffect(()=>{if(open){setError('');setFps(timeline.fps===24||timeline.fps===60?timeline.fps:30);}},[open,timeline.fps]);
  const tooLong = timelineDuration(timeline) > MAX_EXPORT_SECONDS;
  // Exports started in this dialog are timed by this browser's clock; ones it
  // finds already queued use the server's creation time.
  const startedHere=useRef(false);const queueStarts=useRef(new Map<string,number>());
  const queuedId=!starting&&state?.status==='queued'?state.requestId:undefined;
  if(queuedId&&!queueStarts.current.has(queuedId)){queueStarts.current.set(queuedId,startedHere.current?Date.now():Math.min(Date.now(),state?.createdAt??Date.now()));startedHere.current=false;}
  const queuedSince=queuedId?queueStarts.current.get(queuedId):undefined;
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(queuedSince===undefined)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[queuedSince]);
  const queuedFor=queuedSince===undefined?0:Math.max(0,now-queuedSince);
  const slowQueue=queuedFor>=SLOW_QUEUE_MS;
  const [retrying,setRetrying]=useState(false);
  async function startExport(){setError('');setStarting(true);startedHere.current=true;try{await onExport({resolution,fps,quality});}catch(e){startedHere.current=false;setError(userError(e, 'Export failed.'));}finally{setStarting(false);}}
  async function stopExport(){if(!onCancel||!activeJob?.requestId)return;setError('');setStopping(true);try{await onCancel(activeJob.requestId);}catch(e){setError(userError(e,'Could not stop this export.'));}finally{setStopping(false);}}
  async function retryExport(){if(!onCancel||!activeJob?.requestId||retrying||tooLong)return;setError('');setRetrying(true);try{await onCancel(activeJob.requestId);startedHere.current=true;await onExport({resolution:(activeJob.resolution as 720|1080|undefined)??resolution,fps:(activeJob.fps as 24|30|60|undefined)??fps,quality:activeJob.quality==='high'?'high':activeJob.quality==='standard'?'standard':quality,...(activeJob.sourceClipId!==undefined?{clipId:activeJob.sourceClipId}:{})});}catch(e){startedHere.current=false;setError(userError(e,'The waiting export was stopped, but a new one could not start. Export again when you’re ready.'));}finally{setRetrying(false);}}
  async function downloadVideo(){if(!onDownload||!state?.requestId||downloading)return;setError('');setDownloading(true);try{await onDownload(state.requestId);}catch(e){setError(userError(e,'Could not download this export.'));}finally{setDownloading(false);}}
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog"><DialogTitle>Ready for your feed.</DialogTitle><DialogDescription>{clipOnly?'This clip’s section, with the audio, text and effects visible in that section.':'A little story, ready to go out into the world.'}</DialogDescription><div className="export-summary"><div className="export-thumb">{coverUrl?<img src={coverUrl} alt=""/>:<Film size={24}/>}</div><div><h3>{title}</h3><p>MP4 · {timeline.aspectRatio==='vertical'?'Portrait':timeline.aspectRatio==='square'?'Square':'Landscape'}</p><span>{formatTime(timelineDuration(timeline))} · {timeline.clips.length} clips</span></div></div>
    <div className="export-fields"><Field label="Resolution"><select value={activeJob?.resolution??resolution} disabled={working} onChange={e=>setResolution(Number(e.target.value) as 720|1080|2160)}>{(ultra||activeJob?.resolution===2160)&&<option value={2160}>4K · Ultra</option>}<option value={1080}>1080p · Full HD</option><option value={720}>720p · HD</option></select></Field><Field label="Frame rate"><select value={activeJob?.fps??fps} disabled={working} onChange={e=>setFps(Number(e.target.value) as 24|30|60)}>{[24,30,60].map(v=><option key={v} value={v}>{v} fps</option>)}</select></Field><Field label="Quality"><select value={activeJob?.quality??quality} disabled={working} onChange={e=>setQuality(e.target.value as 'standard'|'high')}>{activeJob?.quality==='draft'&&<option value="draft">Draft</option>}<option value="standard">Standard · smaller file</option><option value="high">High · finer detail</option></select></Field></div>
    <div className="export-info">Your timeline becomes an H.264 MP4 with audio, up to {MAX_EXPORT_LABEL} long. Rendering continues in the background.</div>
    {tooLong&&<p role="status" className="export-error">Exports currently support up to five minutes. Shorten the final edit before exporting; your full arrangement remains saved.</p>}
    {working&&<ProcessingStatus label={starting||state?.status==='queued'?slowQueue?'Still waiting for a renderer…':'Starting a render machine…':'Rendering your video…'} detail={queuedSince!==undefined?slowQueue?`Waiting ${formatTime(queuedFor/1000)}. Renderers may be busy. Keep waiting, try again, or stop this export.`:'This usually takes a few seconds.':'Processing your saved edit.'} progress={!starting&&state?.status==='rendering'?state.progress:null}/>}
    {slowQueue&&activeJob?.requestId&&onCancel&&<Button variant="secondary" disabled={retrying||stopping||tooLong} onClick={retryExport}><RotateCcw size={14}/>{retrying?'Restarting export…':'Try again'}</Button>}
    {activeJob?.requestId&&onCancel&&<Button variant="secondary" disabled={stopping||retrying} onClick={stopExport}><Square size={14}/>{stopping?'Stopping export…':'Stop export'}</Button>}
    {state?.status==='cancelled'&&<ProcessingStatus state="stopped" label="Export stopped." detail="Your saved edit is unchanged."/>}
    {state?.current&&state.status==='completed'&&state.url&&!working?<><ProcessingStatus state="ready" label="Your video is ready."/>{onDownload&&state.requestId?<Button className="export-main" disabled={downloading} onClick={downloadVideo}>{downloading?<LoaderCircle size={16} className="animate-spin"/>:<Download size={16}/>}Download</Button>:<Button asChild className="export-main"><a href={state.url} target="_blank" rel="noopener noreferrer" download={`${title}.mp4`}><Download size={16}/>Download</a></Button>}<Button variant="secondary" onClick={startExport} disabled={demo||working||tooLong}>Export a new version</Button></>:<Button className="export-main" disabled={working||!timeline.clips.length||demo||tooLong} onClick={startExport}>{working?<LoaderCircle size={16} className="animate-spin"/>:<Download size={16}/>}Export MP4</Button>}
    {(error||(state?.current&&state?.error))&&<ProcessingStatus state="error" label="Couldn’t export this video." detail={error||(state?.current?state.error:null)}/ >}{demo?<p className="export-demo">Create a project with your own footage to export a video.</p>:!timeline.clips.length&&!working&&<p role="status" className="export-demo">Add a clip to export.</p>}
  </DialogContent></Dialog>;
}
