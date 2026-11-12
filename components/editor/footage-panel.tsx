'use client';
import { userError } from '@/lib/user-error';
import { useId, useState } from 'react';
import { Plus, Upload, LoaderCircle, MoreHorizontal, MessageSquarePlus, Trash2, X, RotateCcw, AlertCircle, Film, Image as ImageIcon, Music2 } from 'lucide-react';
import { FootageProgressBar } from './footage-progress-bar';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { MediaAsset, formatTime } from '@/lib/editor/types';
import { LARGE_UPLOAD_BYTES } from '@/lib/editor/limits';
import { hiddenFromLibrary } from '@/lib/editor/library-visibility';
import './footage-panel.css';
import { VideoImportProgress, type VideoImportState } from './video-link-import';
import { MediaThumbnail } from './media-thumbnail';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type FileKind = 'video' | 'image' | 'audio';
export type QueuedUpload = {id:string;name:string;percent:number;kind:FileKind;error?:string;/** Shown instead of the name while the upload resumes or waits for the connection. */activity?:string;/** Set once the file is stored; its source tile takes over from here. */assetId?:string};
export type UploadProgress = {name:string;percent:number;size?:number;index?:number;total?:number;queue?:QueuedUpload[];activity?:string;phase?:'reading'|'uploading'|'saving'|'preparing'|'watching'|'listening';
  /** Present while the transfer can still be stopped. */
  onCancel?:()=>void}|null;
/** A file whose transfer failed in this session; the editor keeps the file so it can be sent again. */
export type FailedUpload = {id:string;name:string;kind:FileKind;error:string};

function KindIcon({ kind }: { kind: MediaAsset['kind'] }) {
  return kind === 'audio' ? <Music2/> : kind === 'image' ? <ImageIcon/> : <Film/>;
}

/** The editor's Media tab: one Add media button over a three-column grid of the project's media. Each tile carries
 * its own state (uploading, processing, failed); dragging a ready tile to the timeline or clicking it adds it. */
export function FootagePanel({assets,onUpload,onAdd,upload,videoImports=[],onRemove,onAttach,usedAssetIds=[],resumeHint,failedUploads=[],onRetryUpload,onDismissUpload,onRetryPreparation}: {
  /** Offers to continue an interrupted upload when its file is added again. */resumeHint?:string;
  onAttach?:(asset:MediaAsset)=>void;assets:MediaAsset[];
  /** Opens the Add media dialog. */onUpload:()=>void;
  onAdd:(a:MediaAsset)=>void;upload:UploadProgress;videoImports?:VideoImportState[];onRemove?:(asset:MediaAsset)=>Promise<void>;usedAssetIds?:readonly string[];
  failedUploads?:FailedUpload[];onRetryUpload?:(id:string)=>void;onDismissUpload?:(id:string)=>void;
  /** Starts a failed preparation step again. */onRetryPreparation?:(asset:MediaAsset)=>Promise<void>;
}) {
  const [removal,setRemoval]=useState<MediaAsset|null>(null);
  const uploadHint=useId();
  const [removing,setRemoving]=useState(false);
  const [removeError,setRemoveError]=useState('');
  const [retrying,setRetrying]=useState<string|null>(null);
  const [retryError,setRetryError]=useState('');
  const extractedAudio=new Set(assets.flatMap(asset=>asset.kind==='video'&&asset.audioAssetId?[asset.audioAssetId]:[]));
  // Audio the editor made by itself stays on the timeline only, unless the user saved it.
  const sources=assets.filter(asset=>!hiddenFromLibrary(asset,extractedAudio.has(asset._id)));
  const known=new Set(assets.map(asset=>asset._id));
  const failedIds=new Set(failedUploads.map(item=>item.id));
  // A queued file shows its own tile until its stored source appears in the grid.
  const queued=(upload?.queue??[]).filter(item=>!item.error&&!failedIds.has(item.id)&&(!item.assetId||!known.has(item.assetId)));
  const current=upload?.index?upload.queue?.[upload.index-1]?.id:undefined;
  const transferring=upload?.phase==='reading'||upload?.phase==='uploading';
  const many=(upload?.total??1)>1;
  async function retryPreparation(asset:MediaAsset){
    if(!onRetryPreparation||retrying)return;
    setRetrying(asset._id);setRetryError('');
    try{await onRetryPreparation(asset);}catch(error){setRetryError(userError(error,`Could not restart “${asset.fileName}”.`));}
    finally{setRetrying(null);}
  }
  const empty=!sources.length&&!queued.length&&!failedUploads.length;
  return <div className="footage-content footage-content-inspector footage-content-library"><Button className="source-import-files" aria-describedby={upload?uploadHint:undefined} onClick={onUpload}><Plus size={14}/>Add media</Button>
  {videoImports.filter(task=>!['completed','cancelled'].includes(task.status)).slice(0,3).map(task=><VideoImportProgress key={task._id} task={task} onUpload={onUpload}/>)}
  {upload&&<p id={uploadHint} className="source-note" role="status">{many?`${upload.index??1} of ${upload.total} · `:''}{upload.activity||(upload.phase==='watching'?'Watching your footage…':upload.phase==='listening'?'Listening to your footage…':upload.phase==='reading'?'Reading media…':upload.phase==='preparing'?'Preparing audio…':upload.phase==='saving'?'Adding to your project…':'Uploading footage…')}{upload.size!==undefined&&upload.size>LARGE_UPLOAD_BYTES&&upload.phase==='uploading'?' Large file: keep this tab open.':''}</p>}
  {!upload&&resumeHint&&<p className="source-note" role="status">{resumeHint}</p>}
  {retryError&&<p role="alert" className="source-remove-error">{retryError}</p>}
  {empty?<div className="footage-empty"><Upload size={25}/><p>Add video, images, or audio to your project.</p></div>:<div className="source-media-grid">
    {queued.map(item=>{
      const active=item.id===current&&transferring;
      const waiting=!item.assetId&&!active&&item.percent===0;
      const label=item.assetId?'Preparing':waiting?'Waiting to upload':`Uploading ${Math.round(item.percent)}%`;
      return <article key={item.id} className="source-asset source-tile" data-state={waiting?'waiting':'uploading'} aria-busy="true" title={`${item.name} · ${item.activity??label}`}>
        <div className="source-tile-card" role="img" aria-label={`${item.name}: ${item.activity??label}`}><span className="source-tile-icon"><KindIcon kind={item.kind}/></span>
          <span className="source-tile-badge">{waiting?'Waiting':item.assetId?<LoaderCircle size={10} className="animate-spin"/>:`${Math.round(item.percent)}%`}</span></div>
        {!waiting&&<Progress aria-hidden="true" max={100} value={item.percent} className="source-tile-progress"/>}
        {active&&upload?.onCancel&&<Button type="button" variant="ghost" size="icon-xs" className="source-asset-menu" aria-label={many?'Cancel remaining uploads':'Cancel upload'} title={many?'Cancel remaining uploads':'Cancel upload'} onClick={upload.onCancel}><X/></Button>}
      </article>;
    })}
    {failedUploads.map(item=><article key={item.id} className="source-asset source-tile" data-state="failed" title={`${item.name} · ${item.error}`}>
      <div className="source-tile-card" role="img" aria-label={`${item.name}: upload failed`}><span className="source-tile-icon"><KindIcon kind={item.kind}/></span>
        <span className="source-tile-failed"><AlertCircle size={12}/>Failed</span>
        {onRetryUpload&&<Button type="button" size="icon-xs" className="source-tile-retry" disabled={!!upload} aria-label={`Retry ${item.name}`} title="Retry upload" onClick={()=>onRetryUpload(item.id)}><RotateCcw/></Button>}
      </div>
      {onDismissUpload&&<Button type="button" variant="ghost" size="icon-xs" className="source-asset-menu" aria-label={`Dismiss ${item.name}`} title="Dismiss" onClick={()=>onDismissUpload(item.id)}><X/></Button>}
    </article>)}
    {sources.map(a=>{
      const failed=a.preparation?.status==='failed';
      const processing=a.preparation?.status==='processing';
      const ready=!!a.url&&!a.preparation;
      return <article key={a._id} className="source-asset source-tile" data-state={!a.url?'unavailable':failed?'failed':processing?'processing':'ready'}>
        <button disabled={!ready} aria-busy={processing} data-preparing={processing||undefined} data-unavailable={!a.url||undefined} draggable={ready} onDragStart={e=>{if(!ready){e.preventDefault();return;}e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('revline/asset',a._id);}} onClick={()=>{if(ready)onAdd(a);}} data-asset-id={a._id} className="asset-card source-tile-card" aria-label={a.preparation?`${a.fileName}: ${a.preparation.message}`:a.url?`Add ${a.fileName} to timeline`:`${a.fileName} is unavailable. Re-import this source.`} title={a.preparation?.message??(a.url?a.fileName:`${a.fileName} is unavailable. Re-import this source.`)}>
          <MediaThumbnail asset={a}/>
          {processing?<span className="source-tile-status"><LoaderCircle size={14} className="animate-spin"/></span>
            :failed?<span className="source-tile-failed"><AlertCircle size={12}/>Failed</span>
            :!a.url?<span className="source-tile-badge">Unavailable</span>
            :a.kind!=='image'&&<span className="source-tile-badge">{formatTime(a.duration??0)}</span>}
        </button>
        {failed&&onRetryPreparation&&a.preparation?.task&&<Button type="button" size="icon-xs" className="source-tile-retry" disabled={!!retrying} aria-label={`Retry preparing ${a.fileName}`} title="Retry" onClick={()=>void retryPreparation(a)}>{retrying===a._id?<LoaderCircle className="animate-spin"/>:<RotateCcw/>}</Button>}
        {(processing||a.footageProgress!==undefined&&a.footageProgress<90)&&<div className="source-tile-progress"><FootageProgressBar progressKey={`asset:${a._id}`} value={a.footageProgress??0} label={`Preparing ${a.fileName}`}/></div>}
        {onRemove&&<DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-xs" className="source-asset-menu" aria-label={`Options for ${a.fileName}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{onAttach&&ready&&<DropdownMenuItem onSelect={()=>onAttach(a)}><MessageSquarePlus size={14}/>Attach to chat</DropdownMenuItem>}<DropdownMenuItem disabled={usedAssetIds.includes(a._id)} onSelect={()=>{setRemoveError('');setRemoval(a);}}><Trash2 size={14}/>{usedAssetIds.includes(a._id)?'In timeline · remove clips first':'Remove from Sources'}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
      </article>;
    })}
  </div>}
  <Dialog open={!!removal} onOpenChange={open=>{if(!open&&!removing)setRemoval(null);}}><DialogContent><DialogTitle>Remove from Sources?</DialogTitle><DialogDescription>Remove “{removal?.fileName}” from this project. You can upload it again later.</DialogDescription>{removeError&&<p role="alert" className="source-remove-error">{removeError}</p>}<div className="source-remove-actions"><Button variant="outline" disabled={removing} onClick={()=>setRemoval(null)}>Cancel</Button><Button variant="destructive" disabled={removing} onClick={async()=>{if(!removal||!onRemove||removing)return;setRemoving(true);setRemoveError('');try{await onRemove(removal);setRemoval(null);}catch(error){setRemoveError(userError(error, 'Could not remove this source.'));}finally{setRemoving(false);}}}>{removing?<LoaderCircle size={14} className="animate-spin"/>:<Trash2 size={14}/>}Remove source</Button></div></DialogContent></Dialog></div>;
}
