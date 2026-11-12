'use client';
import { userError } from '@/lib/user-error';
import { useId, useRef, useState } from 'react';
import { Plus, Upload, Link2, LoaderCircle, Search, MoreHorizontal, MessageSquarePlus, Trash2, X, Check, RotateCcw, Film, Image as ImageIcon, Music2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MediaAsset, formatTime } from '@/lib/editor/types';
import { LARGE_UPLOAD_BYTES } from '@/lib/editor/limits';
import { hiddenFromLibrary } from '@/lib/editor/library-visibility';
import './footage-panel.css';
import { VideoImportProgress, useVideoLinkImport, type VideoImportState } from './video-link-import';
import { MediaThumbnail } from './media-thumbnail';
import { FootageProgressBar } from './footage-progress-bar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

type FileKind = 'video' | 'image' | 'audio';
export type QueuedUpload = {id:string;name:string;percent:number;kind:FileKind;error?:string;/** Shown instead of the name while the upload resumes or waits for the connection. */activity?:string;/** Set once the file is stored; its source tile takes over from here. */assetId?:string};
export type UploadProgress = {name:string;percent:number;size?:number;index?:number;total?:number;queue?:QueuedUpload[];activity?:string;phase?:'reading'|'uploading'|'saving'|'preparing'|'watching'|'listening';
  /** Present while the transfer can still be stopped. */
  onCancel?:()=>void}|null;
/** A file whose transfer failed in this session; the editor keeps the file so it can be sent again. */
export type FailedUpload = {id:string;name:string;kind:FileKind;error:string};

type Filter = 'all' | FileKind;
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'video', label: 'Video' }, { value: 'image', label: 'Image' }, { value: 'audio', label: 'Audio' }];
const KIND_LABEL: Record<MediaAsset['kind'], string> = { video: 'Video', image: 'Image', audio: 'Audio', model: '3D model' };
const ACCEPT = 'video/*,audio/*,image/*';

function KindIcon({ kind }: { kind: MediaAsset['kind'] }) {
  return kind === 'audio' ? <Music2 size={18}/> : kind === 'image' ? <ImageIcon size={18}/> : <Film size={18}/>;
}

/** The editor's Media panel: upload or paste a link, filter by type, and add sources at the playhead or by dragging. */
export function FootagePanel({assets,onUpload,onUploadFiles,onImportVideo,onAdd,upload,videoImports=[],onRemove,onAttach,usedAssetIds=[],resumeHint,failedUploads=[],onRetryUpload,onDismissUpload,onRetryPreparation}: {
  /** Offers to continue an interrupted upload when its file is added again. */resumeHint?:string;
  onAttach?:(asset:MediaAsset)=>void;assets:MediaAsset[];
  /** Opens the full Add media dialog. */onUpload:()=>void;
  /** Sends chosen files straight to this project's sources. */onUploadFiles?:(files:File[])=>void;
  /** Imports a YouTube, TikTok, Instagram or other supported link into the project's sources. */onImportVideo?:(url:string)=>Promise<void>;
  /** Adds the source at the playhead. */onAdd:(a:MediaAsset)=>void;
  upload:UploadProgress;videoImports?:VideoImportState[];onRemove?:(asset:MediaAsset)=>Promise<void>;usedAssetIds?:readonly string[];
  failedUploads?:FailedUpload[];onRetryUpload?:(id:string)=>void;onDismissUpload?:(id:string)=>void;
  /** Starts a failed preparation step again. */onRetryPreparation?:(asset:MediaAsset)=>Promise<void>;
}) {
  const [search,setSearch]=useState('');
  const [removal,setRemoval]=useState<MediaAsset|null>(null);
  const [removing,setRemoving]=useState(false);
  const [removeError,setRemoveError]=useState('');
  const [kind,setKind]=useState<Filter>('all');
  const [showAutoAudio,setShowAutoAudio]=useState(false);
  const [linkOpen,setLinkOpen]=useState(false);
  const [retrying,setRetrying]=useState<string|null>(null);
  const [retryError,setRetryError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const uploadHint=useId();
  const used=new Set(usedAssetIds);
  const extractedAudio=new Set(assets.flatMap(asset=>asset.kind==='video'&&asset.audioAssetId?[asset.audioAssetId]:[]));
  // Audio the editor made by itself stays on the timeline only, unless the user saved it or asks to see it.
  const autoAudio=assets.filter(asset=>hiddenFromLibrary(asset,extractedAudio.has(asset._id)));
  const listed=assets.filter(asset=>showAutoAudio||!autoAudio.includes(asset));
  const known=new Set(assets.map(asset=>asset._id));
  // A queued file shows its own tile until its stored source appears in the list.
  const failedIds=new Set(failedUploads.map(item=>item.id));
  const queued=(upload?.queue??[]).filter(item=>!failedIds.has(item.id)&&(!item.assetId||!known.has(item.assetId)));
  const current=upload?.index?(upload.queue?.[upload.index-1]?.id):undefined;
  const transferring=upload?.phase==='reading'||upload?.phase==='uploading';
  const imports=videoImports.filter(task=>!['completed','cancelled'].includes(task.status)).slice(0,3);
  const counts:Record<Filter,number>={all:listed.length+queued.length+failedUploads.length,video:0,image:0,audio:0};
  for(const item of [...listed,...queued,...failedUploads])if(item.kind!=='model')counts[item.kind]++;
  const query=search.trim().toLowerCase();
  const matches=(item:{kind:MediaAsset['kind'];name:string})=>(kind==='all'||item.kind===kind)&&item.name.toLowerCase().includes(query);
  const sources=listed.filter(asset=>matches({kind:asset.kind,name:asset.fileName}));
  // Uploads in flight stay visible under any filter, so Cancel is always reachable.
  const queueTiles=queued;
  const failedTiles=failedUploads.filter(item=>matches(item));
  const empty=!listed.length&&!queued.length&&!failedUploads.length;
  const browse=()=>{if(onUploadFiles)fileInput.current?.click();else onUpload();};
  const uploadDisabled=!!upload;

  async function retryPreparation(asset:MediaAsset){
    if(!onRetryPreparation||retrying)return;
    setRetrying(asset._id);setRetryError('');
    try{await onRetryPreparation(asset);}catch(error){setRetryError(userError(error,`Could not restart “${asset.fileName}”.`));}
    finally{setRetrying(null);}
  }

  const link=linkOpen&&onImportVideo?<PasteLink onImport={onImportVideo} onClose={()=>setLinkOpen(false)}/>:null;
  return <div className="footage-content footage-content-inspector footage-content-library media-panel">
    <input ref={fileInput} type="file" accept={ACCEPT} multiple className="sr-only" tabIndex={-1} aria-label="Choose media to upload" onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value='';if(files.length)onUploadFiles?.(files);}}/>
    {!empty&&<div className="media-panel-actions">
      <Button size="sm" className="source-import-files media-panel-upload" disabled={uploadDisabled} aria-describedby={upload?uploadHint:undefined} onClick={browse}><Upload/>Upload</Button>
      {onImportVideo&&<Button size="sm" variant="outline" className="media-panel-link" aria-expanded={linkOpen} onClick={()=>setLinkOpen(open=>!open)}><Link2/>Paste link</Button>}
    </div>}
    {!empty&&link}
    {upload&&<p id={uploadHint} className="media-panel-note">{upload.size!==undefined&&upload.size>LARGE_UPLOAD_BYTES&&upload.phase==='uploading'?'Large file: keep this tab open. ':''}{(upload.total??1)>1?`Uploading ${upload.total} files. `:''}You can add more when these are in.</p>}
    {!upload&&resumeHint&&<p className="media-panel-note" role="status">{resumeHint}</p>}
    {imports.map(task=><VideoImportProgress key={task._id} task={task} onUpload={browse}/>)}
    {empty?<div className="media-panel-empty">
      <Button type="button" variant="outline" className="media-panel-drop" disabled={uploadDisabled} onClick={browse}>
        <Upload size={22} strokeWidth={1.5}/>
        <strong>Drop files here</strong>
        <span>or click to upload</span>
        <small>Video · MP4, MOV, WebM<br/>Images · JPG, PNG, WebP<br/>Audio · MP3, WAV, M4A</small>
      </Button>
      {onImportVideo&&<div className="media-panel-empty-link">
        {link??<Button variant="outline" size="sm" className="media-panel-link" onClick={()=>setLinkOpen(true)}><Link2/>Paste link</Button>}
        <small>YouTube, TikTok and Instagram videos. Public videos up to 3 hours.</small>
      </div>}
    </div>:<>
      <ToggleGroup type="single" size="sm" spacing={1} className="media-panel-filters" aria-label="Filter by type" value={kind} onValueChange={value=>{if(value)setKind(value as Filter);}}>
        {FILTERS.map(filter=><ToggleGroupItem key={filter.value} value={filter.value} className="media-panel-chip">{filter.label}<span className="media-panel-count">{counts[filter.value]}</span></ToggleGroupItem>)}
      </ToggleGroup>
      <div className="source-search relative"><Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/><Input className="pl-8" aria-label="Search media" placeholder="Search media" value={search} onChange={event=>setSearch(event.target.value)}/></div>
      {retryError&&<p role="alert" className="source-remove-error">{retryError}</p>}
      {!sources.length&&!queueTiles.length&&!failedTiles.length?<p className="source-no-results">No matching media.</p>:<div className="media-panel-grid">
        {queueTiles.map(item=>{
          const active=item.id===current&&transferring;
          const waiting=!item.assetId&&!active&&item.percent===0;
          const status=item.assetId?(item.activity??'Preparing…'):waiting?'Waiting to upload':item.activity??`Uploading · ${Math.round(item.percent)}%`;
          return <article key={item.id} className="media-tile" data-state={waiting?'waiting':'uploading'} aria-busy="true">
            <div className="media-tile-thumb"><span className="media-tile-placeholder"><KindIcon kind={item.kind}/></span>
              {active&&upload?.onCancel&&<Button type="button" variant="ghost" size="icon-xs" className="media-tile-corner" aria-label={(upload.total??1)>1?'Cancel remaining uploads':'Cancel upload'} title={(upload.total??1)>1?'Cancel remaining uploads':'Cancel upload'} onClick={upload.onCancel}><X/></Button>}
            </div>
            <div className="media-tile-progress"><Progress aria-label={`Uploading ${item.name}`} max={100} value={item.percent}/></div>
            <div className="media-tile-meta"><span className="media-tile-name" title={item.name}>{item.name}</span><span className="media-tile-status">{!waiting&&<LoaderCircle size={11} className="animate-spin"/>}{status}</span></div>
          </article>;
        })}
        {failedTiles.map(item=><article key={item.id} className="media-tile" data-state="failed">
          <div className="media-tile-thumb"><span className="media-tile-placeholder"><KindIcon kind={item.kind}/></span>
            {onDismissUpload&&<Button type="button" variant="ghost" size="icon-xs" className="media-tile-corner" aria-label={`Dismiss ${item.name}`} title="Dismiss" onClick={()=>onDismissUpload(item.id)}><X/></Button>}
          </div>
          <div className="media-tile-meta"><span className="media-tile-name" title={item.name}>{item.name}</span><span className="media-tile-status" title={item.error}>Upload failed</span>
            {onRetryUpload&&<Button type="button" variant="outline" size="xs" className="media-tile-retry" disabled={uploadDisabled} onClick={()=>onRetryUpload(item.id)}><RotateCcw/>Retry</Button>}</div>
        </article>)}
        {sources.map(a=><SourceTile key={a._id} asset={a} inTimeline={used.has(a._id)} onAdd={onAdd} onAttach={onAttach} onRemove={onRemove?()=>{setRemoveError('');setRemoval(a);}:undefined} retrying={retrying===a._id} onRetry={onRetryPreparation&&a.preparation?.status==='failed'?()=>void retryPreparation(a):undefined}/>)}
      </div>}
      {autoAudio.length>0&&<p className="media-panel-hidden">{autoAudio.length} auto-made audio {autoAudio.length===1?'file':'files'} {showAutoAudio?'shown':'hidden'} · <Button type="button" variant="link" size="xs" className="media-panel-hidden-toggle" onClick={()=>setShowAutoAudio(value=>!value)}>{showAutoAudio?'Hide':'Show'}</Button></p>}
    </>}
    <Dialog open={!!removal} onOpenChange={open=>{if(!open&&!removing)setRemoval(null);}}><DialogContent><DialogTitle>Remove from Sources?</DialogTitle><DialogDescription>Remove “{removal?.fileName}” from this project. You can upload it again later.</DialogDescription>{removeError&&<p role="alert" className="source-remove-error">{removeError}</p>}<div className="source-remove-actions"><Button variant="outline" disabled={removing} onClick={()=>setRemoval(null)}>Cancel</Button><Button variant="destructive" disabled={removing} onClick={async()=>{if(!removal||!onRemove||removing)return;setRemoving(true);setRemoveError('');try{await onRemove(removal);setRemoval(null);}catch(error){setRemoveError(userError(error, 'Could not remove this source.'));}finally{setRemoving(false);}}}>{removing?<LoaderCircle size={14} className="animate-spin"/>:<Trash2 size={14}/>}Remove source</Button></div></DialogContent></Dialog>
  </div>;
}

function SourceTile({asset:a,inTimeline,onAdd,onAttach,onRemove,onRetry,retrying}:{asset:MediaAsset;inTimeline:boolean;onAdd:(a:MediaAsset)=>void;onAttach?:(a:MediaAsset)=>void;onRemove?:()=>void;onRetry?:()=>void;retrying:boolean}) {
  const failed=a.preparation?.status==='failed';
  const processing=a.preparation?.status==='processing';
  const ready=!!a.url&&!a.preparation;
  const state=!a.url?'unavailable':failed?'failed':processing?'processing':'ready';
  const meta=[KIND_LABEL[a.kind],a.kind!=='image'&&a.duration?formatTime(a.duration):''].filter(Boolean).join(' · ');
  const status=!a.url?'Unavailable · re-import it':failed?(a.preparation!.message.replace(/ Retry preparation\.$/,'')):processing?a.preparation!.message:meta;
  return <article className="media-tile" data-state={state} data-in-timeline={inTimeline||undefined}>
    <div className="media-tile-thumb">
      <button type="button" className="media-tile-card" disabled={!ready} aria-busy={processing} draggable={ready} data-asset-id={a._id}
        onDragStart={e=>{if(!ready){e.preventDefault();return;}e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('revline/asset',a._id);}}
        onClick={()=>{if(ready)onAdd(a);}}
        aria-label={ready?`Add ${a.fileName} at the playhead`:`${a.fileName}: ${status}`} title={ready?`${a.fileName} · drag to the timeline or click to add at the playhead`:status}>
        <MediaThumbnail asset={a}/>
      </button>
      {inTimeline&&<span className="media-tile-used" title="In the timeline"><Check/>In timeline</span>}
      {a.kind!=='image'&&a.duration?<span className="source-tile-badge">{formatTime(a.duration)}</span>:null}
      {ready&&<Button type="button" size="icon-xs" className="media-tile-add" aria-label={`Add ${a.fileName} at the playhead`} title="Add at playhead" onClick={()=>onAdd(a)}><Plus/></Button>}
    </div>
    {(processing||a.footageProgress!==undefined&&a.footageProgress<90)&&<div className="media-tile-progress"><FootageProgressBar progressKey={`asset:${a._id}`} value={a.footageProgress??0} label={`Preparing ${a.fileName}`}/></div>}
    <div className="media-tile-meta">
      <span className="media-tile-name" title={a.fileName}>{a.fileName}</span>
      <span className="media-tile-status">{processing&&<LoaderCircle size={11} className="animate-spin"/>}{status}</span>
      {onRetry&&<Button type="button" variant="outline" size="xs" className="media-tile-retry" disabled={retrying} onClick={onRetry}>{retrying?<LoaderCircle className="animate-spin"/>:<RotateCcw/>}Retry</Button>}
      {(onRemove||onAttach&&ready)&&<DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-xs" className="source-asset-menu" aria-label={`Options for ${a.fileName}`}><MoreHorizontal/></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{onAttach&&ready&&<DropdownMenuItem onSelect={()=>onAttach(a)}><MessageSquarePlus size={14}/>Attach to chat</DropdownMenuItem>}{onRemove&&<DropdownMenuItem disabled={inTimeline} onSelect={onRemove}><Trash2 size={14}/>{inTimeline?'In timeline · remove clips first':'Remove from Sources'}</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}
    </div>
  </article>;
}

/** Inline link field: the same import path as the Add media dialog and the composer. */
function PasteLink({onImport,onClose}:{onImport:(url:string)=>Promise<void>;onClose:()=>void}) {
  const id=useId();
  const {url,busy,error,submit,change}=useVideoLinkImport(async value=>{await onImport(value);onClose();});
  return <form className="media-panel-paste" onSubmit={event=>{event.preventDefault();void submit();}}>
    <div className="media-panel-paste-field">
      <Input id={id} type="url" required autoFocus maxLength={2048} placeholder="YouTube, TikTok or Instagram link" aria-label="Video link" autoComplete="off" value={url} disabled={busy} aria-invalid={!!error} aria-describedby={error?`${id}-error`:undefined} onChange={event=>change(event.target.value)} onKeyDown={event=>{if(event.key==='Escape')onClose();}}/>
      <Button type="submit" size="sm" disabled={busy||!url.trim()}>{busy?<LoaderCircle className="animate-spin" aria-label="Starting import"/>:'Import'}</Button>
    </div>
    {error&&<p id={`${id}-error`} className="video-link-error" role="alert">{error}</p>}
  </form>;
}
