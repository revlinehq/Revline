'use client';

import { useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { Check, ChevronDown, FileVideo, LoaderCircle, Upload, X, AlertCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia } from '@/lib/editor/media';
import type { UploadActivity } from '@/lib/editor/multipart-upload';
import { backendLacks, uploadResumable } from '@/lib/editor/upload-resume';
import { uploadActivityLabel } from '@/lib/editor/upload-source';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PrimaryButton } from './primary-button';

type UploadState = {kind:'waiting'} | {kind:'reading'} | {kind:'uploading';percent:number;activity?:UploadActivity} | {kind:'saving'} | {kind:'done'} | {kind:'failed';message:string} | {kind:'cancelled'};
type UploadRow = {name:string;size:number;state:UploadState};
function displayName(name:string){return name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}__/i,'');}
function bytes(value:number){if(value===0)return '0 MB';if(value<1_000_000)return `${Math.max(1,Math.round(value/1_000))} KB`;return value>=1_000_000_000?`${(value/1_000_000_000).toFixed(1)} GB`:`${Math.max(1,Math.round(value/1_000_000))} MB`;}

function label(state:UploadState) {
  switch(state.kind){
    case 'waiting':return 'Waiting';
    case 'reading':return 'Reading media…';
    case 'uploading':return (state.activity&&uploadActivityLabel(state.activity,state.percent))??`${state.percent}% uploaded`;
    case 'saving':return 'Saving to cloud…';
    case 'done':return 'Saved to cloud';
    case 'failed':return state.message;
    case 'cancelled':return 'Cancelled';
  }
}

export function CloudUpload({disabled,onUploaded}:{disabled:boolean;onUploaded:()=>void}) {
  const pendingFiles=useRef<File[]>([]);
  const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null),running=useRef(false);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[rows,setRows]=useState<UploadRow[]>([]),[error,setError]=useState('');
  const start=useAction(api.cloudMedia.start),partUrl=useAction(api.cloudMedia.partUrl),partUrls=useAction(api.cloudMedia.partUrls),resume=useAction(api.cloudMedia.resume),complete=useAction(api.cloudMedia.complete),abort=useAction(api.cloudMedia.abort);
  async function upload(files:File[]) {
    if(running.current||!files.length)return;
    setError('');setOpen(true);
    if(files.length>20){setRows([]);setError('Choose up to 20 files at a time.');return;}
    pendingFiles.current=files;running.current=true;setBusy(true);setRows(files.map(file=>({name:file.name,size:file.size,state:{kind:'waiting'}})));
    const request=new AbortController();controller.current=request;
    const update=(index:number,state:UploadState)=>setRows(current=>current.map((row,i)=>i===index?{...row,state}:row));
    try{
      for(const [index,file] of files.entries()){
        if(request.signal.aborted){update(index,{kind:'cancelled'});continue;}
        try{
          update(index,{kind:'reading'});
          const metadata=await inspectMedia(file);
          request.signal.throwIfAborted();
          const kind=metadata.kind;
          if(kind==='model')throw new Error('Choose video, audio or image files.');
          // Choosing a file whose upload was interrupted continues it; the transport releases or keeps the unfinished upload.
          await uploadResumable<Id<'cloudMedia'>,null>(file,{
            scope:'library',
            start:()=>start({...metadata,kind,fileName:file.name,contentType:file.type,size:file.size}),
            resume:(uploadId,parts)=>resume({uploadId,size:file.size,parts}).catch(error=>{if(!backendLacks(error))throw error;return null;}),
            partUrls:(uploadId,from,count)=>partUrls({uploadId,from,count}).catch(async error=>{if(!backendLacks(error))throw error;return [{partNumber:from,url:await partUrl({uploadId,partNumber:from}),expiresAt:Date.now()+3600_000}];}),
            complete:(uploadId,parts)=>complete({uploadId,parts}),
            abort:uploadId=>abort({uploadId}),
          },(percent,activity)=>update(index,{kind:'uploading',percent,activity}),request.signal,()=>update(index,{kind:'saving'}));
          update(index,{kind:'done'});onUploaded();
        }catch(reason){
          update(index,request.signal.aborted?{kind:'cancelled'}:{kind:'failed',message:userError(reason,'Could not upload this file. Try again.')});
        }
      }
    }finally{controller.current=null;running.current=false;setBusy(false);}
  }
  const completed=rows.filter(row=>row.state.kind==='done').length;
  const failed=rows.filter(row=>row.state.kind==='failed'||row.state.kind==='cancelled').length;
  const total=rows.reduce((sum,row)=>sum+row.size,0);
  const transferred=rows.reduce((sum,row)=>sum+row.size*(row.state.kind==='done'||row.state.kind==='saving'?1:row.state.kind==='uploading'?row.state.percent/100:0),0);
  const percent=total?Math.round(transferred/total*100):0;
  const title=busy?`Uploading ${rows.length} ${rows.length===1?'file':'files'}`:failed?'Some files need attention':rows.length?'Upload complete':'Upload files';
  return <>
    <Input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="storage-sr-only" aria-label="Choose files to upload to cloud storage" disabled={disabled||busy} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void upload(files);}}/>
    <PrimaryButton disabled={disabled} onClick={()=>{if(busy)setOpen(true);else input.current?.click();}}>{busy?<LoaderCircle size={14} className="animate-spin"/>:<Upload size={14}/>} {busy?`Uploading · ${percent}%`:'Upload files'}</PrimaryButton>
    {open&&<Card className="storage-upload-panel" role="region" aria-label="File uploads">
      <CardHeader className="storage-upload-header"><div><CardTitle aria-live="polite">{title}</CardTitle><p>{busy?`${bytes(transferred)} of ${bytes(total)} · ${completed} of ${rows.length} saved`:`${completed} ${completed===1?'file':'files'} saved to your library`}</p></div><Button variant="ghost" size="icon" aria-label={busy?'Minimize uploads':'Close uploads'} onClick={()=>setOpen(false)}>{busy?<ChevronDown size={16}/>:<X size={16}/>}</Button></CardHeader>
      <CardContent className="storage-upload-content">
        {busy&&<div className="storage-upload-total"><Progress value={percent} aria-label="Total upload progress"/><span>{percent}%</span></div>}
        <ul className="storage-upload-queue">{rows.map((row,index)=><li key={index} data-state={row.state.kind}>
          <span className="storage-upload-icon">{row.state.kind==='done'?<Check size={18}/>:row.state.kind==='failed'?<AlertCircle size={18}/>:<FileVideo size={18}/>}</span>
          <div className="storage-upload-file"><strong title={row.name}>{displayName(row.name)}</strong><small>{bytes(row.size)} · {label(row.state)}</small>{row.state.kind==='uploading'&&<Progress value={row.state.percent} aria-label={`Uploading ${displayName(row.name)}`}/>}</div>
          {['reading','uploading','saving'].includes(row.state.kind)&&<LoaderCircle size={14} className="animate-spin"/>}
        </li>)}</ul>
        {error&&<p className="workspace-inline-error" role="alert">{error}</p>}
        <div className="storage-upload-footer">{busy?<><span>Keep this tab open while uploading.</span><Button variant="ghost" size="sm" onClick={()=>controller.current?.abort()}>Cancel upload</Button></>:<><Button variant="outline" size="sm" onClick={()=>input.current?.click()}>Add files</Button>{failed>0?<PrimaryButton onClick={()=>void upload(pendingFiles.current.filter((_,index)=>rows[index]?.state.kind==='failed'||rows[index]?.state.kind==='cancelled'))}>Retry {failed===1?'file':`${failed} files`}</PrimaryButton>:<PrimaryButton onClick={()=>setOpen(false)}>Done</PrimaryButton>}</>}</div>
      </CardContent>
    </Card>}
  </>;
}
