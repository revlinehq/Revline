'use client';
import { MAX_EXPORT_SECONDS } from '@/lib/editor/limits';
import { useState } from 'react';
import { Download, LoaderCircle, Check, Film, AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from './primitives';
import { formatTime, timelineDuration, type Timeline } from '@/lib/editor/types';
export type ExportSettings={resolution:720|1080;fps:24|30|60;quality:'standard'|'high'};
export type ExportState={status:'queued'|'rendering'|'completed'|'failed';progress?:number;url?:string|null;error?:string|null}|null;
export function ExportDialog({open,onOpenChange,title,timeline,coverUrl,onExport,state,demo}: {open:boolean;onOpenChange:(v:boolean)=>void;title:string;timeline:Timeline;coverUrl?:string|null;onExport:(settings:ExportSettings)=>Promise<void>;state:ExportState;demo:boolean}) {
  const [resolution,setResolution]=useState<720|1080>(1080);const [fps,setFps]=useState<24|30|60>(30);const [quality,setQuality]=useState<'standard'|'high'>('standard');const [starting,setStarting]=useState(false);const [error,setError]=useState('');const working=starting||state?.status==='queued'||state?.status==='rendering';
  const tooLong = timelineDuration(timeline) > MAX_EXPORT_SECONDS;
  async function startExport(){setError('');setStarting(true);try{await onExport({resolution,fps,quality});}catch(e){setError(e instanceof Error?e.message:'Export failed.');}finally{setStarting(false);}}
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="export-dialog"><DialogTitle>Ready for your feed.</DialogTitle><DialogDescription>A little story, ready to go out into the world.</DialogDescription><div className="export-summary"><div className="export-thumb">{coverUrl?<img src={coverUrl} alt=""/>:<Film size={24}/>}</div><div><h3>{title}</h3><p>MP4 · {timeline.aspectRatio==='vertical'?'Portrait':timeline.aspectRatio==='square'?'Square':'Landscape'}</p><span>{formatTime(timelineDuration(timeline))} · {timeline.clips.length} layers and clips</span></div></div>
    <div className="export-fields"><Field label="Resolution"><select value={resolution} disabled={working} onChange={e=>setResolution(Number(e.target.value) as 720|1080)}><option value={1080}>1080p · Full HD</option><option value={720}>720p · HD</option></select></Field><Field label="Frame rate"><select value={fps} disabled={working} onChange={e=>setFps(Number(e.target.value) as 24|30|60)}>{[24,30,60].map(v=><option key={v} value={v}>{v} fps</option>)}</select></Field><Field label="Quality"><select value={quality} disabled={working} onChange={e=>setQuality(e.target.value as 'standard'|'high')}><option value="standard">Standard · smaller file</option><option value="high">High · finer detail</option></select></Field></div>
    <div className="export-info">Your timeline becomes an H.264 MP4 with audio. Rendering continues in the background.</div>
    {tooLong&&<p role="status" className="export-error">Exports currently support up to five minutes. Shorten the final edit before exporting; your full arrangement remains saved.</p>}
    {working&&<div className="export-progress" role="status"><span><LoaderCircle size={14} className="animate-spin"/>Rendering your story… <b>{Math.round(starting?0:state?.progress??0)}%</b></span><progress max={100} value={starting?0:state?.progress??0}/></div>}
    {state?.status==='completed'&&state.url&&!working?<><div className="export-ready"><Check size={14}/>Your video is ready.</div><Button asChild className="export-main"><a href={state.url} target="_blank" rel="noopener noreferrer" download={`${title}.mp4`}><Download size={16}/>Export video</a></Button><Button variant="secondary" onClick={startExport} disabled={demo||working||tooLong}>Export a new version</Button></>:<Button className="export-main" disabled={working||!timeline.clips.length||demo||tooLong} onClick={startExport}>{working?<LoaderCircle size={16} className="animate-spin"/>:<Download size={16}/>}Export MP4</Button>}
    {(error||state?.error)&&<div role="alert" className="export-error"><AlertCircle size={14}/>{error||state?.error}</div>}{demo&&<p className="export-demo">Create a project with your own footage to export a video.</p>}
  </DialogContent></Dialog>;
}
