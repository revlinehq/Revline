'use client';

import { useRef, useState } from 'react';
import { useAction } from 'convex/react';
import { Check, LoaderCircle, Upload } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { inspectMedia, uploadMultipart } from '@/lib/editor/media';
import { userError } from '@/lib/user-error';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from './primary-button';

type UploadState = {kind:'waiting'} | {kind:'reading'} | {kind:'uploading';percent:number} | {kind:'saving'} | {kind:'done'} | {kind:'failed';message:string} | {kind:'cancelled'};
type UploadRow = {name:string;state:UploadState};
function label(state:UploadState) {
  switch(state.kind){
    case 'waiting':return 'Waiting';
    case 'reading':return 'Reading media…';
    case 'uploading':return `${state.percent}% uploaded`;
    case 'saving':return 'Saving to cloud…';
    case 'done':return 'Saved to cloud';
    case 'failed':return state.message;
    case 'cancelled':return 'Cancelled';
  }
}

export function CloudUpload({disabled,onUploaded}:{disabled:boolean;onUploaded:()=>void}) {
  const input=useRef<HTMLInputElement>(null),controller=useRef<AbortController|null>(null),running=useRef(false);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[rows,setRows]=useState<UploadRow[]>([]),[error,setError]=useState('');
  const start=useAction(api.cloudMedia.start),partUrl=useAction(api.cloudMedia.partUrl),complete=useAction(api.cloudMedia.complete),abort=useAction(api.cloudMedia.abort);
  async function upload(files:File[]) {
    if(running.current||!files.length)return;
    setError('');setOpen(true);
    if(files.length>20){setRows([]);setError('Choose up to 20 files at a time.');return;}
    running.current=true;setBusy(true);setRows(files.map(file=>({name:file.name,state:{kind:'waiting'}})));
    const request=new AbortController();controller.current=request;
    const update=(index:number,state:UploadState)=>setRows(current=>current.map((row,i)=>i===index?{...row,state}:row));
    try{
      for(const [index,file] of files.entries()){
        if(request.signal.aborted){update(index,{kind:'cancelled'});continue;}
        let uploadId:Id<'cloudMedia'>|undefined;
        let saved=false;
        try{
          update(index,{kind:'reading'});
          const metadata=await inspectMedia(file);
          request.signal.throwIfAborted();
          if(metadata.kind==='model')throw new Error('Choose video, audio or image files.');
          const opened=await start({...metadata,kind:metadata.kind,fileName:file.name,contentType:file.type,size:file.size});
          uploadId=opened.uploadId;request.signal.throwIfAborted();
          const parts=await uploadMultipart(file,opened.partSize,partNumber=>partUrl({uploadId:opened.uploadId,partNumber}),percent=>update(index,{kind:'uploading',percent}),request.signal);
          request.signal.throwIfAborted();update(index,{kind:'saving'});
          await complete({uploadId,parts});saved=true;
          update(index,{kind:'done'});onUploaded();
        }catch(reason){
          if(uploadId&&!saved)await abort({uploadId}).catch(()=>undefined);
          update(index,request.signal.aborted?{kind:'cancelled'}:{kind:'failed',message:userError(reason,'Could not upload this file. Try again.')});
        }
      }
    }finally{controller.current=null;running.current=false;setBusy(false);}
  }
  return <>
    <Input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="storage-sr-only" aria-label="Choose files to upload to cloud storage" disabled={disabled||busy} onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';void upload(files);}}/>
    <PrimaryButton disabled={disabled||busy} onClick={()=>input.current?.click()}>{busy?<LoaderCircle size={14} className="animate-spin"/>:<Upload size={14}/>}Upload to cloud</PrimaryButton>
    <Dialog open={open} onOpenChange={value=>{if(!busy)setOpen(value);}}><DialogContent className="workspace-dialog storage-upload-dialog"><DialogTitle>Upload to cloud</DialogTitle><DialogDescription>Save footage now. Create an edit when you’re ready, on any device. Keep this page open until uploads finish.</DialogDescription>
      <ul className="storage-upload-list">{rows.map((row,index)=><li key={index}><div><strong>{row.name}</strong>{row.state.kind==='done'?<Check size={14}/>:['reading','uploading','saving'].includes(row.state.kind)&&<LoaderCircle size={14} className="animate-spin"/>}</div><small className={row.state.kind==='failed'?'workspace-inline-error':undefined}>{label(row.state)}</small>{row.state.kind==='uploading'&&<Progress value={row.state.percent} aria-label={`Uploading ${row.name}`}/>}</li>)}</ul>
      {error&&<p className="workspace-inline-error" role="alert">{error}</p>}
      <div className="workspace-dialog-actions">{busy?<Button variant="outline" onClick={()=>controller.current?.abort()}>Cancel remaining</Button>:<><Button variant="outline" onClick={()=>{setOpen(false);input.current?.click();}}>Upload more</Button><PrimaryButton onClick={()=>setOpen(false)}>Done</PrimaryButton></>}</div>
    </DialogContent></Dialog>
  </>;
}
