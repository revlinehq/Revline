'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { useDeferredValue,useState,useEffect } from 'react';
import Link from 'next/link';
import { useConvexAuth,useMutation,usePaginatedQuery,useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ArrowDown,ArrowUpRight,Download,Film,ImageIcon,LoaderCircle,LockKeyhole,Music2,Search,Trash2,Upload } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Dialog,DialogContent,DialogDescription,DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from './primary-button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceNav } from './workspace-nav';
import './storage-page.css';

type StorageFile=FunctionReturnType<typeof api.storage.files>['page'][number];
type Summary=FunctionReturnType<typeof api.storage.summary>;
type Filters={kind:'all'|'video'|'audio'|'image'|'export';search:string;sort:'largest'|'newest';unused:boolean};
const defaultFilters:Filters={kind:'all',search:'',sort:'largest',unused:false};
const categories=[['all','All'],['video','Video'],['audio','Audio'],['image','Images'],['export','Exports']] as const;
const icons={video:Film,audio:Music2,image:ImageIcon,export:Download};
const breakdown=[['videoBytes','Video'],['audioBytes','Audio'],['imageBytes','Images'],['exportBytes','Exports']] as const;
export function formatStorageBytes(bytes:number){if(bytes===0)return '0 GB';if(bytes<1_000_000)return `${Math.max(1,Math.round(bytes/1_000))} KB`;if(bytes<1_000_000_000)return `${Math.round(bytes/1_000_000)} MB`;return `${Number((bytes/1_000_000_000).toFixed(1))} GB`;}

export function StoragePage(){
  const {isAuthenticated}=useConvexAuth();
  const [filters,setFilters]=useState(defaultFilters),search=useDeferredValue(filters.search);
  const summary=useQuery(api.storage.summary,isAuthenticated?{}:'skip');
  const {results,status,loadMore}=usePaginatedQuery(api.storage.files,isAuthenticated?{search,sort:filters.sort,unused:filters.unused,...(filters.kind==='all'?{}:{kind:filters.kind})}:'skip',{initialNumItems:20});
  const scanning=filters.unused&&results.length===0&&status==='CanLoadMore';
  useEffect(()=>{if(scanning)loadMore(20);},[scanning,loadMore,results.length]);
  const remove=useMutation(api.storage.remove);
  return <div className="workspace-page storage-page"><WorkspaceNav title="Cloud storage" active="storage"/><StorageBrowser summary={summary} files={results} filters={filters} onFilters={setFilters} loading={!isAuthenticated||status==='LoadingFirstPage'||scanning||(filters.unused&&results.length===0&&status==='LoadingMore')} loadingMore={status==='LoadingMore'} hasMore={status==='CanLoadMore'} onLoadMore={()=>loadMore(20)} onDelete={async files=>{await remove({fileIds:files.map(file=>file.id)});}}/></div>;
}

export function StorageBrowser({summary,files,filters,onFilters,loading,loadingMore,hasMore,onLoadMore,onDelete}:{summary?:Summary;files:StorageFile[];filters:Filters;onFilters:(value:Filters)=>void;loading:boolean;loadingMore:boolean;hasMore:boolean;onLoadMore:()=>void;onDelete:(files:StorageFile[])=>Promise<void>}){
  const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const chosen=files.filter(file=>selected.has(file.id)&&file.canDelete),selectable=files.filter(file=>file.canDelete).slice(0,20);
  const available=summary?Math.max(0,summary.limitBytes-summary.usedBytes-summary.reservedBytes):0;
  const ready=summary?.ready;
  function changeFilters(patch:Partial<Filters>){setSelected(new Set());onFilters({...filters,...patch});}
  async function deleteFiles(){if(busy||!chosen.length)return;setBusy(true);setError('');try{await onDelete(chosen);setSelected(new Set());setConfirm(false);}catch(reason){setError(userError(reason, 'Could not delete these files. Please retry.'));}finally{setBusy(false);}}
  return <main className="storage-content">
    <div className="storage-heading"><div><h1>Cloud storage</h1><p>Keep your media organized. Make room for your next edit.</p></div><PrimaryButton asChild><Link href={NEW_PROJECT_PATH}>Upload media<Upload size={14}/></Link></PrimaryButton></div>
    <section className="storage-usage" aria-label="Cloud storage usage" aria-busy={!ready}>
      <div className="storage-usage-top"><div><p>Storage used</p>{ready?<strong>{formatStorageBytes(summary.usedBytes)}<small>of {formatStorageBytes(summary.limitBytes)}</small></strong>:<Skeleton style={{height:28,width:185}}/>}</div>{ready?<span>{formatStorageBytes(available)} available</span>:<Skeleton style={{height:13,width:115}}/>}</div>
      <div className="storage-meter" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={summary?.limitBytes??15_000_000_000} aria-valuenow={ready?summary.usedBytes:0}>
        {breakdown.map(([field],index)=><span key={field} className={`storage-color-${index}`} style={{width:`${ready?Math.min(100,summary[field]/summary.limitBytes*100):0}%`}}/>)}
      </div>
      <div className="storage-breakdown">{breakdown.map(([field,label],index)=><span key={field}><i className={`storage-color-${index}`}/>{label}<b>·</b>{ready?formatStorageBytes(summary[field]):<Skeleton as="span" style={{display:'inline-block',height:11,width:35}}/>}</span>)}</div>
      {ready&&summary.reservedBytes>0&&<p className="storage-reserved">{formatStorageBytes(summary.reservedBytes)} reserved for uploads in progress.</p>}
    </section>
    <section className="storage-library" aria-label="Stored media" aria-busy={loading}>
      <div className="storage-library-heading"><div><h2>All media</h2><p>{ready?`${summary.fileCount} ${summary.fileCount===1?'file':'files'} across your workspaces`:'Your media and exports'}</p></div><button className="workspace-outline-button" aria-pressed={filters.unused} onClick={()=>changeFilters({unused:!filters.unused})}>{filters.unused?'Show all media':'Review unused'}</button></div>
      <div className="storage-toolbar"><label className="storage-search"><Search size={14}/><input type="search" aria-label="Search media" placeholder="Search media" value={filters.search} maxLength={120} onChange={event=>changeFilters({search:event.target.value})}/></label><div className="storage-categories" role="group" aria-label="Media type">{categories.map(([value,label])=><button key={value} aria-pressed={filters.kind===value} onClick={()=>changeFilters({kind:value})}>{label}</button>)}</div><button className="storage-sort" aria-label="Change storage sorting" onClick={()=>changeFilters({sort:filters.sort==='largest'?'newest':'largest'})}>{filters.sort==='largest'?'Largest first':'Newest first'}<ArrowDown size={12}/></button></div>
      {chosen.length>0&&<div className="storage-selection" role="status"><span>{chosen.length} selected · {formatStorageBytes(chosen.reduce((sum,file)=>sum+file.size,0))}</span><button className="workspace-outline-button" onClick={()=>{setError('');setConfirm(true);}}><Trash2 size={13}/>Delete selected</button></div>}
      <div className="storage-table-wrap"><table className="storage-table"><thead><tr><th className="storage-check"><input type="checkbox" aria-label="Select unused files on this page" disabled={!selectable.length||loading} checked={selectable.length>0&&selectable.every(file=>selected.has(file.id))} onChange={event=>setSelected(event.target.checked?new Set(selectable.map(file=>file.id)):new Set())}/></th><th>Name</th><th className="storage-used">Used in</th><th className="storage-size">Size</th><th className="storage-added">Added</th><th><span className="storage-sr-only">Actions</span></th></tr></thead><tbody>
        {loading?Array.from({length:5},(_,index)=><tr key={index} aria-hidden="true" className="storage-skeleton-row"><td className="storage-check"><Skeleton style={{width:14,height:14}}/></td><td><div className="storage-file"><Skeleton style={{width:38,height:38,flexShrink:0}}/><div style={{width:'70%'}}><Skeleton style={{height:12,width:'100%'}}/><Skeleton style={{height:9,width:'35%',marginTop:7}}/></div></div></td><td className="storage-used"><Skeleton style={{height:12,width:'70%'}}/></td><td className="storage-size"><Skeleton style={{height:12,width:45}}/></td><td className="storage-added"><Skeleton style={{height:12,width:42}}/></td><td className="storage-row-action"><Skeleton style={{height:14,width:14}}/></td></tr>):files.map(file=>{const Icon=icons[file.kind];return <tr key={file.id} data-file-id={file.id}><td className="storage-check"><input type="checkbox" aria-label={`Select ${file.fileName}`} disabled={!file.canDelete||(!selected.has(file.id)&&chosen.length>=20)} checked={file.canDelete&&selected.has(file.id)} onChange={event=>setSelected(current=>{const next=new Set(current);if(event.target.checked)next.add(file.id);else next.delete(file.id);return next;})}/></td><td><div className={`storage-file storage-file-${file.kind}`}>{file.thumbnailUrl?<img className="storage-file-icon storage-file-thumb" src={file.thumbnailUrl} alt="" loading="lazy" decoding="async"/>:<span className="storage-file-icon"><Icon size={17}/></span>}<div><strong title={file.fileName}>{file.fileName}</strong><small>{categories.find(([key])=>key===file.kind)?.[1].replace('Images','Image').replace('Exports','Export')}</small></div></div></td><td className="storage-used">{file.workspaces.length===1?<Link href={`/editor/${file.workspaces[0].id}`}>{file.workspaces[0].title}</Link>:file.workspaces.length>1?`${file.workspaces.length} workspaces`:file.canDelete?<span className="storage-unused">{file.kind==='export'?'Not in an edit':'Unused'}</span>:<span title={file.protectedReason??undefined}>{file.protectedReason}</span>}</td><td className="storage-size">{formatStorageBytes(file.size)}</td><td className="storage-added">{new Date(file.createdAt).toLocaleDateString(undefined,{month:'short',day:'2-digit'})}</td><td className="storage-row-action">{file.canDelete?<button aria-label={`Delete ${file.fileName}`} onClick={()=>{setSelected(new Set([file.id]));setError('');setConfirm(true);}}><Trash2 size={14}/></button>:file.workspaces[0]?<Link href={`/editor/${file.workspaces[0].id}`} aria-label={`Open workspace for ${file.fileName}`} title={file.protectedReason??undefined}><ArrowUpRight size={14}/></Link>:<LockKeyhole size={13} aria-label={file.protectedReason??'Protected file'}/>}</td></tr>;})}
      </tbody></table></div>
      {loading?<span className="storage-sr-only" role="status">Loading your media…</span>:!files.length&&<div className="storage-empty">{filters.unused?'No unused files in these results.':filters.search||filters.kind!=='all'?'No media matches your search.':'Your media and exports will appear here.'}</div>}
      {(hasMore||loadingMore)&&<div className="storage-load-more"><button className="workspace-outline-button" disabled={loadingMore} onClick={onLoadMore}>{loadingMore&&<LoaderCircle size={13} className="animate-spin"/>}{loadingMore?'Loading…':'Load more'}</button></div>}
      <p className="storage-protection"><LockKeyhole size={12}/>Files used in an edit stay protected. Open their workspace to remove them first.</p>
    </section>
    <Dialog open={confirm} onOpenChange={open=>{if(!busy)setConfirm(open);}}><DialogContent className="workspace-dialog"><DialogTitle>Delete {chosen.length===1?'this file':`${chosen.length} files`}?</DialogTitle><DialogDescription>This permanently removes the selected media from your library and unused workspace sources. Media still used by an edit or shared timeline is protected.</DialogDescription><p className="storage-delete-size">{formatStorageBytes(chosen.reduce((sum,file)=>sum+file.size,0))} of account storage will be freed.</p>{error&&<p className="workspace-inline-error" role="alert">{error}</p>}<div className="workspace-dialog-actions"><button className="workspace-outline-button" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button><PrimaryButton disabled={busy||!chosen.length} onClick={()=>void deleteFiles()}>{busy&&<LoaderCircle size={13} className="animate-spin"/>}{busy?'Deleting…':'Delete files'}</PrimaryButton></div></DialogContent></Dialog>
  </main>;
}
