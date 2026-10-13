'use client';
import { useState } from 'react';
import { Plus, Upload, Check, LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MediaAsset, formatTime } from '@/lib/editor/types';
import './footage-panel.css';
import { VideoImportProgress, type VideoImportState } from './video-link-import';
import { MediaThumbnail } from './media-thumbnail';
export type QueuedUpload = {id:string;name:string;percent:number;kind:'video'|'image'|'audio';error?:string};
export type UploadProgress = {name:string;percent:number;size?:number;index?:number;total?:number;queue?:QueuedUpload[];phase?:'reading'|'uploading'|'saving'}|null;
export function FootagePanel({assets,onUpload,onAdd,upload,variant='sheet',videoImports=[]}: {assets:MediaAsset[];onUpload:()=>void;onAdd:(a:MediaAsset)=>void;upload:UploadProgress;variant?:'sheet'|'inspector';videoImports?:VideoImportState[]}) {
  const [search,setSearch]=useState('');
  const [kind,setKind]=useState<'all'|MediaAsset['kind']>('all');
  const sources=assets.filter(asset=>(kind==='all'||asset.kind===kind)&&asset.fileName.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className={`footage-content footage-content-${variant}`}><div className="footage-heading"><div><p>{assets.length} {assets.length===1?'asset':'assets'} in this project</p></div><Button variant="secondary" size="icon" disabled={!!upload} onClick={onUpload} aria-label="Import footage"><Plus size={16}/></Button></div>
  {videoImports.filter(task=>!['completed','cancelled'].includes(task.status)).slice(0,3).map(task=><VideoImportProgress key={task._id} task={task}/>)}
  {variant==='inspector'&&<div className="source-filters"><label className="source-search"><Search size={13}/><input aria-label="Search sources" placeholder="Search sources" value={search} onChange={event=>setSearch(event.target.value)}/></label><select aria-label="Source type" value={kind} onChange={event=>setKind(event.target.value as typeof kind)}><option value="all">All media</option><option value="video">Video</option><option value="audio">Audio</option><option value="image">Images</option></select></div>}
  {upload&&<div className="upload-status"><span><LoaderCircle size={13} className="animate-spin"/>{upload.name}</span><progress max="100" value={upload.percent}/><small>{upload.phase==='reading'?'Reading media…':upload.phase==='saving'?'Adding to your project…':`${upload.percent}% uploaded`}</small></div>}
  {!assets.length?<div className="footage-empty"><Upload size={25}/><p>Every story begins with a moment.</p><Button variant="secondary" disabled={!!upload} onClick={onUpload}>Bring your footage</Button></div>:!sources.length?<p className="source-no-results">No matching sources.</p>:<div className={variant==='inspector'?'source-media-list':'asset-grid'}>{sources.map(a=><button disabled={!a.url} draggable={!!a.url} onDragStart={e=>{if(!a.url){e.preventDefault();return;}e.dataTransfer.effectAllowed='copy';e.dataTransfer.setData('revline/asset',a._id);}} onClick={()=>{if(a.url)onAdd(a);}} key={a._id} data-asset-id={a._id} className={`asset-card ${variant==='inspector'?'source-media-row':''}`} title={a.url?`Add ${a.fileName} to timeline`:`${a.fileName} is unavailable. Re-import this source.`}>{variant==='inspector'?<><MediaThumbnail asset={a}/><span className="source-media-details"><strong>{a.fileName}</strong><small>{!a.url?'Unavailable · re-import source':a.kind==='image'?'Image':`${formatTime(a.duration??0)} · ${a.kind==='video'?'Video':'Audio'}`}</small></span>{a.url&&<Plus size={12} aria-hidden="true"/>}</>:<><div className="asset-thumbnail"><MediaThumbnail asset={a}/><span className="asset-ready">{a.url?<><Check size={9}/>Ready</>:'Unavailable'}</span>{a.url&&<span className="asset-add"><Plus size={14}/></span>}</div><strong>{a.fileName}</strong><small>{!a.url?'Unavailable · re-import source':a.kind==='image'?'Image':`${formatTime(a.duration??0)} · ${a.kind==='video'?'Video':'Audio'}`}</small></>}</button>)}</div>}
  <p className="footage-tip">Click to add. Drag to place on the timeline.</p></div>;
}
