'use client';

import { useRef, useState } from 'react';
import { Upload, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VideoLinkImport } from './video-link-import';
import './media-import-dialog.css';

export function MediaImportDialog({ open, onOpenChange, onUpload, onImportVideo, disabled=false }: {
  open:boolean; onOpenChange:(open:boolean)=>void; onUpload:(files:File[])=>void;
  onImportVideo?:(url:string)=>Promise<void>; disabled?:boolean;
}) {
  const input=useRef<HTMLInputElement>(null);
  const [dragging,setDragging]=useState(false);
  const [starting,setStarting]=useState(false);
  const busy=disabled||starting;
  function attach(files:File[]) {
    if(busy||!files.length)return;
    setDragging(false);onOpenChange(false);onUpload(files);
  }
  return <Dialog open={open} onOpenChange={value=>{if(!starting){setDragging(false);onOpenChange(value);}}}>
    <DialogContent className="media-import-dialog" onDragEnter={event=>{
      if(event.dataTransfer.types.includes('Files'))event.stopPropagation();
    }} onDragOver={event=>{
      if(!event.dataTransfer.types.includes('Files'))return;
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=busy?'none':'copy';if(!busy)setDragging(true);
    }} onDragLeave={event=>{event.stopPropagation();if(!event.currentTarget.contains(event.relatedTarget as Node))setDragging(false);}} onDrop={event=>{
      if(!event.dataTransfer.types.includes('Files'))return;
      event.preventDefault();event.stopPropagation();setDragging(false);attach(Array.from(event.dataTransfer.files));
    }}>
      <DialogTitle>Add media</DialogTitle>
      <DialogDescription>Upload your clips or import a video link.</DialogDescription>
      <button type="button" className={`media-import-drop ${dragging?'is-dragging':''}`} disabled={busy} onClick={()=>input.current?.click()}>
        <Upload size={24} strokeWidth={1.5}/><strong>{dragging?'Drop your media here':'Drag and drop your media'}</strong><span>or click to choose files</span><small>Video, images & audio</small>
      </button>
      <input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label="Choose media to upload" onChange={event=>{attach(Array.from(event.target.files??[]));event.target.value='';}}/>
      <div className="media-import-divider"><span>or</span></div>
      {onImportVideo?<VideoLinkImport disabled={busy} onImport={async url=>{
        setStarting(true);
        try{await onImportVideo(url);onOpenChange(false);}finally{setStarting(false);}
      }}/>:<a className="media-import-link" href="/dashboard/chat"><Link2 size={16}/>Import from YouTube or MP4</a>}
    </DialogContent>
  </Dialog>;
}
