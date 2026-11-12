'use client';
import { userError } from '@/lib/user-error';
import { useId, useState } from 'react';
import { Plus, Upload, LoaderCircle, Search, MoreHorizontal, MessageSquarePlus, Trash2, X } from 'lucide-react';
import { FootageProgressBar } from './footage-progress-bar';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MediaAsset, formatTime } from '@/lib/editor/types';
import { LARGE_UPLOAD_BYTES } from '@/lib/editor/limits';
import { hiddenFromLibrary } from '@/lib/editor/library-visibility';
import './footage-panel.css';
import { VideoImportProgress, type VideoImportState } from './video-link-import';
import { MediaThumbnail } from './media-thumbnail';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
export type QueuedUpload = {id:string;name:string;percent:number;kind:'video'|'image'|'audio';error?:string;/** Shown instead of the name while the upload resumes or waits for the connection. */activity?:string};
export type UploadProgress = {name:string;percent:number;size?:number;index?:number;total?:number;queue?:QueuedUpload[];activity?:string;phase?:'reading'|'uploading'|'saving'|'preparing'|'watching'|'listening';
  /** Present while the transfer can still be stopped. */
  onCancel?:()=>void}|null;
export function FootagePanel({assets,onUpload,onAdd,upload,videoImports=[],onRemove,onAttach,usedAssetIds=[],resumeHint}: {/** Offers to continue an interrupted upload when its file is added again. */resumeHint?:string;onAttach?:(asset:MediaAsset)=>void;assets:MediaAsset[];onUpload:()=>void;onAdd:(a:MediaAsset)=>void;upload:UploadProgress;videoImports?:VideoImportState[];onRemove?:(asset:MediaAsset)=>Promise<void>;usedAssetIds?:readonly string[]}) {
  const [search,setSearch]=useState('');
  const [removal,setRemoval]=useState<MediaAsset|null>(null);
  const uploadHint=useId();
  const [removing,setRemoving]=useState(false);
  const [removeError,setRemoveError]=useState('');
  const [kind,setKind]=useState<'all'|MediaAsset['kind']>('all');
  const extractedAudio=new Set(assets.flatMap(asset=>asset.kind==='video'&&asset.audioAssetId?[asset.audioAssetId]:[]));
  // Audio the editor made by itself stays on the timeline only, unless the user saved it.
  const originals=assets.filter(asset=>!hiddenFromLibrary(asset,extractedAudio.has(asset._id)));
  const sources=originals.filter(asset=>(kind==='all'||asset.kind===kind)&&asset.fileName.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="footage-content footage-content-inspector footage-content-library"><Button className="source-import-files" disabled={!!upload} aria-describedby={upload?uploadHint:undefined} onClick={onUpload}><Plus size={14}/>Add files</Button>
  {videoImports.filter(task=>!['completed','cancelled'].includes(task.status)).slice(0,3).map(task=><VideoImportProgress key={task._id} task={task} onUpload={onUpload}/>)}
  <div className="source-filters"><div className="source-search relative"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/><Input className="pl-8" aria-label="Search sources" placeholder="Search sources" value={search} onChange={event=>setSearch(event.target.value)}/></div><Select value={kind} onValueChange={value=>setKind(value as typeof kind)}><SelectTrigger size="sm" className="w-full" aria-label="Source type"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="all">All media</SelectItem><SelectItem value="video">Video</SelectItem><SelectItem value="audio">Audio</SelectItem><SelectItem value="image">Images</SelectItem></SelectContent></Select></div>
  {upload&&<div className="upload-status"><span><LoaderCircle size={13} className="animate-spin"/>{upload.name}</span><Progress aria-label="Footage preparation progress" max={100} value={upload.percent}/><small>{Math.round(upload.percent)}%</small><small>{upload.activity|| (upload.phase==='watching'?'Watching your footage…':upload.phase==='listening'?'Listening to your footage…':upload.phase==='reading'?'Reading media…':upload.phase==='preparing'?'Preparing audio…':upload.phase==='saving'?'Adding to your project…':'Uploading footage…')}</small><small id={uploadHint}>{upload.size!==undefined&&upload.size>LARGE_UPLOAD_BYTES&&upload.phase==='uploading'?'Large file. This can take a while; keep this tab open. ':''}You can add more files when this one is in.</small>{upload.onCancel&&<Button variant="ghost" size="sm" className="upload-cancel" onClick={upload.onCancel}><X size={12}/>Cancel upload</Button>}</div>}
  {!upload&&resumeHint&&<div className="upload-status" role="status"><small>{resumeHint}</small></div>}
  {!originals.length?<div className="footage-empty"><Upload size={25}/><p>Add video, images, or audio to your project.</p></div>:!sources.length?<p className="source-no-results">No matching sources.</p>:<div className="source-media-grid">{sources.map(a=><article key={a._id} className="source-asset source-tile"><button disabled={!a.url||!!a.preparation} aria-busy={a.preparation?.status==='processing'} data-preparing={a.preparation?.status==='processing'||undefined} data-unavailable={!a.url||undefined} draggable={!!a.url&&!a.preparation} onDragStart={e=>{if(!a.url||a.preparation){e.preventDefault();return;}e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('revline/asset',a._id);}} onClick={()=>{if(a.url&&!a.preparation)onAdd(a);}} data-asset-id={a._id} className="asset-card source-tile-card" aria-label={a.preparation?`${a.fileName}: ${a.preparation.message}`:a.url?`Add ${a.fileName} to timeline`:`${a.fileName} is unavailable. Re-import this source.`} title={a.preparation?.message??(a.url?a.fileName:`${a.fileName} is unavailable. Re-import this source.`)}><MediaThumbnail asset={a}/>{a.preparation?<span className="source-tile-status"><LoaderCircle size={14} className="animate-spin"/></span>:!a.url?<span className="source-tile-badge">Unavailable</span>:a.kind!=='image'&&<span className="source-tile-badge">{formatTime(a.duration??0)}</span>}</button>{a.footageProgress!==undefined&&a.footageProgress<90&&<FootageProgressBar progressKey={`asset:${a._id}`} value={a.footageProgress} label={`Preparing ${a.fileName}`}/>}
{onRemove&&<DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-xs" className="source-asset-menu" aria-label={`Options for ${a.fileName}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{onAttach&&a.url&&!a.preparation&&<DropdownMenuItem onSelect={()=>onAttach(a)}><MessageSquarePlus size={14}/>Attach to chat</DropdownMenuItem>}<DropdownMenuItem disabled={usedAssetIds.includes(a._id)} onSelect={()=>{setRemoveError('');setRemoval(a);}}><Trash2 size={14}/>{usedAssetIds.includes(a._id)?'In timeline · remove clips first':'Remove from Sources'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</article>)}</div>}
  <Dialog open={!!removal} onOpenChange={open=>{if(!open&&!removing)setRemoval(null);}}><DialogContent><DialogTitle>Remove from Sources?</DialogTitle><DialogDescription>Remove “{removal?.fileName}” from this project. You can upload it again later.</DialogDescription>{removeError&&<p role="alert" className="source-remove-error">{removeError}</p>}<div className="source-remove-actions"><Button variant="outline" disabled={removing} onClick={()=>setRemoval(null)}>Cancel</Button><Button variant="destructive" disabled={removing} onClick={async()=>{if(!removal||!onRemove||removing)return;setRemoving(true);setRemoveError('');try{await onRemove(removal);setRemoval(null);}catch(error){setRemoveError(userError(error, 'Could not remove this source.'));}finally{setRemoving(false);}}}>{removing?<LoaderCircle size={14} className="animate-spin"/>:<Trash2 size={14}/>}Remove source</Button></div></DialogContent></Dialog></div>;
}
