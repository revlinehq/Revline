'use client';
import { useState } from 'react';
import { Upload,Film,LoaderCircle,Check,X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UploadProgress } from './footage-panel';
import './project-entry.css';
import { VideoImportProgress, type VideoImportState } from './video-link-import';

export function ProjectImportStage({upload,onBrowse,onUpload,importTask}:{upload:UploadProgress;onBrowse:()=>void;onUpload:(files:File[])=>Promise<void>;importTask?:VideoImportState}){
  const [dragging,setDragging]=useState(false);
  const busy=!!upload||!!importTask&&!['failed','completed','cancelled'].includes(importTask.status);
  return <section className={`project-import-stage ${dragging?'import-dragging':''}`} aria-label="Prepare your project" onDragOver={e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();if(!busy)setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);if(!busy&&e.dataTransfer.files.length)void onUpload(Array.from(e.dataTransfer.files));}}>
    <div className="import-heading"><h1>{busy?'Getting your footage ready.':'Give your story a starting point.'}</h1><p>{busy?'Your editor will open when everything is ready.':'Add videos, images, or audio. We’ll take it from there.'}</p></div>
    {importTask&&busy?<VideoImportProgress task={importTask}/>:upload?<div className="import-progress-card" role="status" aria-live="polite"><div className="import-file"><span className="import-file-icon"><Film size={23}/></span><div><strong title={upload.name}>{upload.name}</strong><span>{upload.size!==undefined?`${(upload.size/1024/1024).toFixed(1)} MB · `:''}{upload.index&&upload.total?`File ${upload.index} of ${upload.total}`:'Preparing footage'}</span></div>{upload.phase==='saving'?<Check size={18}/>:<LoaderCircle size={19} className="animate-spin"/>}</div><div className="import-progress-label"><span>{upload.activity||(upload.phase==='watching'?'Watching your footage':upload.phase==='listening'?'Listening to your footage':upload.phase==='reading'?'Reading media':upload.phase==='preparing'?'Preparing audio':upload.phase==='saving'?'Adding to your project':'Uploading footage')}</span>{upload.phase==='uploading'&&<span>{upload.percent}%</span>}</div><progress aria-label="Footage upload progress" max={100} {...(upload.phase==='uploading'?{value:upload.percent}:{})}/><p>You can start editing as soon as your footage is in.</p>{upload.onCancel&&<Button variant="ghost" size="sm" className="import-cancel" onClick={upload.onCancel}><X size={13}/>Cancel upload</Button>}</div>:<div className="import-drop-card"><span className="import-drop-icon"><Upload size={25}/></span><h2>{dragging?'Drop your footage here.':'Drop your footage in.'}</h2><p>One clip or a whole story. Start with what you have.</p><Button onClick={onBrowse}>Choose files</Button><span className="import-file-types">Video, images & audio</span></div>}
  {importTask&&!busy&&<VideoImportProgress task={importTask}/>}
  </section>;
}
