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
export type ExportSettings={resolution:720|1080|2160;fps:24|30|60;quality:'standard'|'high';clipId?:string;sectionId?:string;timelineId?:string};
export type ExportState={status:'queued'|'rendering'|'completed'|'failed'|'cancelled';progress?:number;url?:string|null;error?:string|null;current?:boolean;sourceClipId?:string;sourceSectionId?:string;sourceTimelineId?:string;label?:string;requestId?:string;createdAt?:number;resolution?:number;fps?:number;quality?:string}|null;
/** One row of the project's export queue and history. */
export type ExportListItem={id:string;status:NonNullable<ExportState>['status'];progress?:number;label?:string;createdAt:number;resolution?:number;sourceClipId?:string;aspectRatio?:string};
/** What the dialog exports: the whole timeline, one section, or every section. */
export type ExportTargetOption={id:string;label:string};
/** A timeline tab offered in the export checklist. */
export type ExportTimelineOption={id:string;name:string;aspectRatio:string;duration:number};
export function ExportDialog({open,onOpenChange,title,timeline,coverUrl,onExport,onCancel,onDownload,state,demo,clipOnly=false,ultra=false,targets=[],target='timeline',onTarget,videoCount=1,totalSeconds,exports=[],timelines=[],selectedTimelines=[],onSelectTimelines}: {timelines?:ExportTimelineOption[];selectedTimelines?:string[];onSelectTimelines?:(ids:string[])=>void;totalSeconds?:number;targets?:ExportTargetOption[];target?:string;onTarget?:(target:string)=>void;videoCount?:number;exports?:ExportListItem[];ultra?:boolean;open:boolean;onOpenChange:(v:boolean)=>void;title:string;timeline:Timeline;coverUrl?:string|null;onExport:(settings:ExportSettings)=>Promise<string[]|void>;onCancel?:(jobId:string)=>Promise<void>;onDownload?:(jobId:string)=>Promise<void>;state:ExportState;demo:boolean;clipOnly?:boolean}) {
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
  const many=videoCount>1;
  // Several videos at once switch the dialog to following that batch.
  const [batch,setBatch]=useState<string[]>([]);
  useEffect(()=>{if(open)setBatch([]);},[open]);
  async function startExport(){setError('');setStarting(true);startedHere.current=true;try{const ids=await onExport({resolution,fps,quality});if(ids&&ids.length>1)setBatch(ids);}catch(e){startedHere.current=false;setError(userError(e, 'Export failed.'));}finally{setStarting(false);}}
  async function stopExport(){if(!onCancel||!activeJob?.requestId)return;setError('');setStopping(true);try{await onCancel(activeJob.requestId);}catch(e){setError(userError(e,'Could not stop this export.'));}finally{setStopping(false);}}
  async function retryExport(){if(!onCancel||!activeJob?.requestId||retrying||tooLong)return;setError('');setRetrying(true);try{await onCancel(activeJob.requestId);startedHere.current=true;await onExport({resolution:(activeJob.resolution as 720|1080|undefined)??resolution,fps:(activeJob.fps as 24|30|60|undefined)??fps,quality:activeJob.quality==='high'?'high':activeJob.quality==='standard'?'standard':quality,...(activeJob.sourceClipId!==undefined?{clipId:activeJob.sourceClipId}:{})});}catch(e){startedHere.current=false;setError(userError(e,'The waiting export was stopped, but a new one could not start. Export again when you’re ready.'));}finally{setRetrying(false);}}
  async function downloadVideo(){if(!onDownload||!state?.requestId||downloading)return;setError('');setDownloading(true);try{await onDownload(state.requestId);}catch(e){setError(userError(e,'Could not download this export.'));}finally{setDownloading(false);}}
  if(batch.length)return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog"><ExportBatch jobs={batch.flatMap(id=>exports.find(item=>item.id===id)??[])} expected={batch.length} onCancel={onCancel} onDownload={onDownload} onBack={()=>setBatch([])}/></DialogContent></Dialog>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog"><DialogTitle>Ready for your feed.</DialogTitle><DialogDescription>{clipOnly?'This clip’s section, with the audio, text and effects visible in that section.':many?`Each video renders as its own MP4. They queue and finish one after another.`:'A little story, ready to go out into the world.'}</DialogDescription>{!clipOnly&&timelines.length>1&&onSelectTimelines&&<TimelineChecklist timelines={timelines} selected={selectedTimelines} disabled={starting} onChange={onSelectTimelines}/>}{!clipOnly&&targets.length>0&&onTarget&&(timelines.length<=1||selectedTimelines.length===1)&&<div className="export-fields export-target"><Field label="Video"><select value={target} disabled={starting} onChange={e=>onTarget(e.target.value)}><option value="timeline">Whole timeline</option>{targets.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}{targets.length>1&&<option value="all">All {targets.length} videos</option>}</select></Field></div>}<div className="export-summary"><div className="export-thumb" data-ratio={timeline.aspectRatio}>{coverUrl?<img src={coverUrl} alt=""/>:<Film size={24}/>}</div><div><h3>{title}</h3><p>MP4 · {timeline.aspectRatio==='vertical'?'Portrait':timeline.aspectRatio==='square'?'Square':'Landscape'}</p><span>{many?`${videoCount} videos · ${formatTime(totalSeconds??timelineDuration(timeline))} in total`:`${formatTime(timelineDuration(timeline))} · ${timeline.clips.length} clips`}</span></div></div>
    <div className="export-fields"><Field label="Resolution"><select value={activeJob?.resolution??resolution} disabled={working} onChange={e=>setResolution(Number(e.target.value) as 720|1080|2160)}>{(ultra||activeJob?.resolution===2160)&&<option value={2160}>4K · Ultra</option>}<option value={1080}>1080p · Full HD</option><option value={720}>720p · HD</option></select></Field><Field label="Frame rate"><select value={activeJob?.fps??fps} disabled={working} onChange={e=>setFps(Number(e.target.value) as 24|30|60)}>{[24,30,60].map(v=><option key={v} value={v}>{v} fps</option>)}</select></Field><Field label="Quality"><select value={activeJob?.quality??quality} disabled={working} onChange={e=>setQuality(e.target.value as 'standard'|'high')}>{activeJob?.quality==='draft'&&<option value="draft">Draft</option>}<option value="standard">Standard · smaller file</option><option value="high">High · finer detail</option></select></Field></div>
    <div className="export-info">Your timeline becomes an H.264 MP4 with audio, up to {MAX_EXPORT_LABEL} long. Rendering continues in the background.</div>
    {tooLong&&<p role="status" className="export-error">Exports currently support up to five minutes. Shorten the final edit before exporting; your full arrangement remains saved.</p>}
    {working&&<ProcessingStatus label={starting||state?.status==='queued'?slowQueue?'Still waiting for a renderer…':'Starting a render machine…':'Rendering your video…'} detail={queuedSince!==undefined?slowQueue?`Waiting ${formatTime(queuedFor/1000)}. Renderers may be busy. Keep waiting, try again, or stop this export.`:'This usually takes a few seconds.':'Processing your saved edit.'} progress={!starting&&state?.status==='rendering'?state.progress:null}/>}
    {slowQueue&&activeJob?.requestId&&onCancel&&<Button variant="secondary" disabled={retrying||stopping||tooLong} onClick={retryExport}><RotateCcw size={14}/>{retrying?'Restarting export…':'Try again'}</Button>}
    {activeJob?.requestId&&onCancel&&<Button variant="secondary" disabled={stopping||retrying} onClick={stopExport}><Square size={14}/>{stopping?'Stopping export…':'Stop export'}</Button>}
    {state?.status==='cancelled'&&<ProcessingStatus state="stopped" label="Export stopped." detail="Your saved edit is unchanged."/>}
    {state?.current&&state.status==='completed'&&state.url&&!working?<><ProcessingStatus state="ready" label="Your video is ready."/>{onDownload&&state.requestId?<Button className="export-main" disabled={downloading} onClick={downloadVideo}>{downloading?<LoaderCircle size={16} className="animate-spin"/>:<Download size={16}/>}Download</Button>:<Button asChild className="export-main"><a href={state.url} target="_blank" rel="noopener noreferrer" download={`${title}.mp4`}><Download size={16}/>Download</a></Button>}<Button variant="secondary" onClick={startExport} disabled={demo||working||tooLong}>Export a new version</Button></>:<Button className="export-main" disabled={working||!timeline.clips.length||demo||tooLong||timelines.length>1&&!selectedTimelines.length} onClick={startExport}>{working?<LoaderCircle size={16} className="animate-spin"/>:<Download size={16}/>}{many?`Export ${videoCount} videos`:'Export MP4'}</Button>}
    {(error||(state?.current&&state?.error))&&<ProcessingStatus state="error" label="Couldn’t export this video." detail={error||(state?.current?state.error:null)}/ >}{exports.length>1&&<ExportList exports={exports} onCancel={onCancel} onDownload={onDownload}/>}{demo?<p className="export-demo">Create a project with your own footage to export a video.</p>:!timeline.clips.length&&!working&&<p role="status" className="export-demo">Add a clip to export.</p>}
  </DialogContent></Dialog>;
}

const EXPORT_STATUS={queued:'Waiting',rendering:'Rendering',completed:'Ready',failed:'Failed',cancelled:'Stopped'} as const;
/** Recent exports of this project: what is still rendering, waiting, or ready to download. */
function ExportList({exports,onCancel,onDownload}:{exports:ExportListItem[];onCancel?:(jobId:string)=>Promise<void>;onDownload?:(jobId:string)=>Promise<void>}){
  const [busy,setBusy]=useState<string|null>(null);
  const run=async(id:string,action?:(jobId:string)=>Promise<void>)=>{if(!action||busy)return;setBusy(id);try{await action(id);}catch{/* The row's status stays the source of truth. */}finally{setBusy(null);}};
  return <section className="export-list" aria-label="Recent exports"><h4>Recent exports</h4><ul>{exports.map(item=>{
    const active=item.status==='queued'||item.status==='rendering';
    return <li key={item.id} data-status={item.status}><div><strong>{item.label??(item.sourceClipId?'Clip':'Whole timeline')}</strong><span>{EXPORT_STATUS[item.status]}{item.status==='rendering'&&item.progress!==undefined?` · ${Math.round(item.progress)}%`:''}{item.resolution?` · ${item.resolution===2160?'4K':`${item.resolution}p`}`:''}</span></div>
      {item.status==='completed'&&onDownload&&<Button size="sm" variant="secondary" disabled={busy===item.id} onClick={()=>run(item.id,onDownload)}>{busy===item.id?<LoaderCircle size={14} className="animate-spin"/>:<Download size={14}/>}Download</Button>}
      {active&&onCancel&&<Button size="sm" variant="ghost" disabled={busy===item.id} onClick={()=>run(item.id,onCancel)}><Square size={12}/>Stop</Button>}
    </li>;})}</ul></section>;
}

const RATIO_LABEL:Record<string,string>={vertical:'9:16',square:'1:1',landscape:'16:9'};
/** Pick any timelines, or all of them; each exports as its own video. */
function TimelineChecklist({timelines,selected,disabled,onChange}:{timelines:ExportTimelineOption[];selected:string[];disabled:boolean;onChange:(ids:string[])=>void}){
  const chosen=new Set(selected),all=chosen.size===timelines.length;
  const toggle=(id:string)=>onChange(timelines.filter(item=>item.id===id?!chosen.has(id):chosen.has(item.id)).map(item=>item.id));
  return <fieldset className="export-timelines" disabled={disabled}><legend className="sr-only">Timelines to export</legend>
    <label className="export-timelines-all"><input type="checkbox" checked={all} ref={input=>{if(input)input.indeterminate=!all&&chosen.size>0;}} onChange={()=>onChange(all?[]:timelines.map(item=>item.id))}/><span>All timelines</span><small>{chosen.size} of {timelines.length} selected</small></label>
    {timelines.map(item=><label key={item.id} className="export-timeline-row"><input type="checkbox" checked={chosen.has(item.id)} onChange={()=>toggle(item.id)}/><span className="export-timeline-ratio" data-ratio={item.aspectRatio} aria-hidden="true"/><span className="export-timeline-text"><strong>{item.name}</strong><small>{RATIO_LABEL[item.aspectRatio]??item.aspectRatio} · {formatTime(item.duration)} · MP4</small></span></label>)}
  </fieldset>;
}

/** A batch of videos rendering in turn: progress per video, then downloads. */
function ExportBatch({jobs,expected,onCancel,onDownload,onBack}:{jobs:ExportListItem[];expected:number;onCancel?:(jobId:string)=>Promise<void>;onDownload?:(jobId:string)=>Promise<void>;onBack:()=>void}){
  const [busy,setBusy]=useState<string|null>(null);
  const ready=jobs.filter(job=>job.status==='completed');
  const run=async(id:string,action?:(jobId:string)=>Promise<void>)=>{if(!action||busy)return;setBusy(id);try{await action(id);}catch{/* The row keeps the job's real status. */}finally{setBusy(null);}};
  // Browsers drop downloads started in the same instant; space them out.
  const downloadAll=async()=>{if(!onDownload||busy)return;setBusy('all');try{for(const job of ready){await onDownload(job.id);await new Promise(resolve=>setTimeout(resolve,700));}}catch{/* Individual rows still download. */}finally{setBusy(null);}};
  const active=jobs.some(job=>job.status==='queued'||job.status==='rendering')||jobs.length<expected;
  return <>
    <DialogTitle>{active?`Exporting ${expected} videos`:`${ready.length} of ${expected} videos ready`}</DialogTitle>
    <DialogDescription>They render in turn. You can keep editing; each one downloads when it’s ready.</DialogDescription>
    <ul className="export-batch">{jobs.map(job=>{const working=job.status==='queued'||job.status==='rendering';return <li key={job.id} data-status={job.status}>
      <span className="export-timeline-ratio" data-ratio={job.aspectRatio} aria-hidden="true"/>
      <div className="export-batch-text"><strong>{job.label??'Video'}</strong>{job.status==='rendering'?<span className="export-batch-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress??0)}><i style={{width:`${Math.max(4,job.progress??0)}%`}}/></span>:<small>{job.status==='completed'?`Ready${job.resolution?` · ${job.resolution===2160?'4K':`${job.resolution}p`}`:''}`:job.status==='queued'?'Waiting for a renderer':job.status==='failed'?'Failed':'Stopped'}</small>}</div>
      {job.status==='rendering'&&<small className="export-batch-pct">{Math.round(job.progress??0)}%</small>}
      {job.status==='completed'&&onDownload&&<Button size="sm" variant="secondary" disabled={!!busy} onClick={()=>run(job.id,onDownload)}>{busy===job.id?<LoaderCircle size={14} className="animate-spin"/>:<Download size={14}/>}Download</Button>}
      {working&&onCancel&&<button type="button" className="export-batch-stop" aria-label={`Stop exporting ${job.label??'this video'}`} disabled={!!busy} onClick={()=>run(job.id,onCancel)}><Square size={10}/></button>}
    </li>;})}</ul>
    <Button className="export-main" variant={ready.length===expected?'default':'secondary'} disabled={!ready.length||!!busy||!onDownload} onClick={downloadAll}>{busy==='all'?<LoaderCircle size={16} className="animate-spin"/>:<Download size={16}/>}{ready.length===expected?'Download all':`Download all (${ready.length} of ${expected} ready)`}</Button>
    <button type="button" className="export-batch-back" onClick={onBack}>Export something else</button>
  </>;
}
