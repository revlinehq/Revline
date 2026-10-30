'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { useRef, useState } from 'react';
import { Upload, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { VideoLinkImport } from './video-link-import';
import { MediaThumbnail } from './media-thumbnail';
import type { MediaAsset } from '@/lib/editor/types';
import './media-import-dialog.css';

export function MediaImportDialog({ open, onOpenChange, onUpload, onImportVideo, disabled=false, projectMedia=[], onPickProjectMedia }: {
  open:boolean; onOpenChange:(open:boolean)=>void; onUpload:(files:File[])=>void;
  onImportVideo?:(url:string)=>Promise<void>; disabled?:boolean;
  /** Media already in the project that can go out with the message instead of uploading it again. */
  projectMedia?:MediaAsset[]; onPickProjectMedia?:(asset:MediaAsset)=>void;
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
      <DialogDescription>{onPickProjectMedia&&projectMedia.length?'Attach media from this project, upload clips or import a video link.':'Upload your clips or import a video link.'}</DialogDescription>
      {onPickProjectMedia&&projectMedia.length>0&&<div className="media-import-project" role="list" aria-label="Media in this project">{projectMedia.map(asset=><button key={asset._id} type="button" role="listitem" className="media-import-project-item" disabled={busy} title={asset.fileName} aria-label={`Attach ${asset.fileName}`} onClick={()=>{onOpenChange(false);onPickProjectMedia(asset);}}><MediaThumbnail asset={asset}/><span>{asset.fileName}</span></button>)}</div>}
      <button type="button" className={`media-import-drop ${dragging?'is-dragging':''}`} disabled={busy} onClick={()=>input.current?.click()}>
        <Upload size={24} strokeWidth={1.5}/><strong>{dragging?'Drop your media here':'Drag and drop your media'}</strong><span>or click to choose files</span><small>Video, images & audio</small>
      </button>
      <input ref={input} type="file" accept="video/*,audio/*,image/*" multiple className="sr-only" tabIndex={-1} aria-label="Choose media to upload" onChange={event=>{attach(Array.from(event.target.files??[]));event.target.value='';}}/>
      <div className="media-import-divider"><span>or</span></div>
      {onImportVideo?<VideoLinkImport disabled={busy} onImport={async url=>{
        setStarting(true);
        try{await onImportVideo(url);onOpenChange(false);}finally{setStarting(false);}
      }}/>:<a className="media-import-link" href={NEW_PROJECT_PATH}><Link2 size={16}/>Import from YouTube or MP4</a>}
    </DialogContent>
  </Dialog>;
}
