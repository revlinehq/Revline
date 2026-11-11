'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { userError } from '@/lib/user-error';

import { useDeferredValue,useState,useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CloudUpload } from './cloud-upload';
import { useAction,useConvexAuth,useMutation,usePaginatedQuery,useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { ArrowDown,ArrowUpRight,Box,Download,Film,ImageIcon,LoaderCircle,LockKeyhole,Music2,Search,Trash2,Upload } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { Dialog,DialogContent,DialogDescription,DialogTitle } from '@/components/ui/dialog';
import { PrimaryButton } from './primary-button';
import { Skeleton } from '@/components/ui/skeleton';
import { WorkspaceNav } from './workspace-nav';
import './storage-page.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type StorageFile=FunctionReturnType<typeof api.storage.files>['page'][number];
type UnfinishedUpload=FunctionReturnType<typeof api.cloudMedia.unfinished>[number];
type Summary=FunctionReturnType<typeof api.storage.summary>;
type Filters={kind:'all'|'video'|'audio'|'image'|'model'|'export';search:string;sort:'largest'|'newest';unused:boolean};
const defaultFilters:Filters={kind:'all',search:'',sort:'largest',unused:false};
const categories=[['all','All'],['video','Video'],['audio','Audio'],['image','Images'],['model','Models'],['export','Exports']] as const;
const icons={video:Film,audio:Music2,image:ImageIcon,model:Box,export:Download};
const breakdown=[['videoBytes','Video'],['audioBytes','Audio'],['imageBytes','Images'],['modelBytes','Models'],['exportBytes','Exports']] as const;
function formatStorageBytes(bytes:number){if(bytes===0)return '0 GB';if(bytes<1_000_000)return `${Math.max(1,Math.round(bytes/1_000))} KB`;if(bytes<1_000_000_000)return `${Math.round(bytes/1_000_000)} MB`;return `${Number((bytes/1_000_000_000).toFixed(1))} GB`;}
function formatElapsed(ms:number){const minutes=Math.floor(ms/60_000);if(minutes<1)return 'under a minute';if(minutes<60)return `${minutes} min`;const hours=Math.floor(minutes/60);return hours<24?`${hours} h`:`${Math.floor(hours/24)} d`;}
/** Parts are up to 95 MB, so only a long silence suggests a closed tab rather than a slow link. */
const QUIET_MS=30*60_000;

function UnfinishedUploads({reservedBytes}:{reservedBytes:number}){
  const {isAuthenticated}=useConvexAuth();
  const uploads=useQuery(api.cloudMedia.unfinished,isAuthenticated?{}:'skip');
  const abort=useAction(api.cloudMedia.abort);
  const [open,setOpen]=useState(false),[cancelling,setCancelling]=useState<ReadonlySet<string>>(()=>new Set()),[error,setError]=useState('');
  const [now,setNow]=useState(()=>Date.now());
  const count=uploads?.length??0;
  // Close once nothing is left, so a later upload never reopens the dialog by itself.
  useEffect(()=>{if(!count)setOpen(false);},[count]);
  async function cancel(items:UnfinishedUpload[]){
    const ids=items.map(item=>item.uploadId).filter(id=>!cancelling.has(id));if(!ids.length)return;
    setError('');setCancelling(current=>new Set([...current,...ids]));
    const results=await Promise.allSettled(ids.map(uploadId=>abort({uploadId})));
    setCancelling(current=>{const next=new Set(current);for(const id of ids)next.delete(id);return next;});
    const failed=results.find(result=>result.status==='rejected');
    if(failed)setError(userError(failed.reason,'Could not cancel every upload. Please retry.'));
  }
  return <div className="storage-reserved">
    <p>{formatStorageBytes(reservedBytes)} reserved for uploads in progress.</p>
    {count>0&&<Button variant="outline" size="sm" onClick={()=>{setError('');setNow(Date.now());setOpen(true);}}>Review {count} unfinished {count===1?'upload':'uploads'}</Button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="workspace-dialog storage-unfinished-dialog">
      <DialogTitle>Unfinished uploads</DialogTitle>
      <DialogDescription>Uploads that stop sending data are cleared automatically after 2 hours. Choose the same file again before then to continue where it stopped, or cancel them now to free their space. Cancelling an upload still running in another tab stops it.</DialogDescription>
      <ul className="storage-unfinished-list">{uploads?.map(upload=>{const quiet=now-upload.activeAt>=QUIET_MS,busy=cancelling.has(upload.uploadId);return <li key={upload.uploadId}>
        <span className="storage-file-icon"><Upload size={15}/></span>
        <div><strong title={upload.fileName}>{upload.fileName}</strong><small>{formatStorageBytes(upload.size)} · started {formatElapsed(now-upload.createdAt)} ago · {quiet?`no new data for ${formatElapsed(now-upload.activeAt)}`:'uploading'}</small></div>
        <Button variant="ghost" size="sm" disabled={busy} aria-label={`Cancel upload of ${upload.fileName}`} onClick={()=>void cancel([upload])}>{busy?<LoaderCircle size={13} className="animate-spin"/>:'Cancel'}</Button>
      </li>;})}</ul>
      {error&&<p className="workspace-inline-error" role="alert">{error}</p>}
      <div className="workspace-dialog-actions"><Button variant="outline" size="md" onClick={()=>setOpen(false)}>Close</Button>{count>1&&<PrimaryButton disabled={cancelling.size>0} onClick={()=>void cancel(uploads??[])}>{cancelling.size>0&&<LoaderCircle size={13} className="animate-spin"/>}Cancel all {count}</PrimaryButton>}</div>
    </DialogContent></Dialog>
  </div>;
}

export function StoragePage(){
  const {isAuthenticated}=useConvexAuth();
  const [filters,setFilters]=useState(defaultFilters),search=useDeferredValue(filters.search);
  const summary=useQuery(api.storage.summary,isAuthenticated?{}:'skip');
  const {results,status,loadMore}=usePaginatedQuery(api.storage.files,isAuthenticated?{search,sort:filters.sort,unused:filters.unused,...(filters.kind==='all'?{}:{kind:filters.kind})}:'skip',{initialNumItems:20});
  const scanning=filters.unused&&results.length===0&&status==='CanLoadMore';
  useEffect(()=>{if(scanning)loadMore(20);},[scanning,loadMore,results.length]);
  const remove=useMutation(api.storage.remove);
  return <div className="workspace-page storage-page"><WorkspaceNav title="Cloud storage" active="storage"/><StorageBrowser summary={summary} files={results} filters={filters} onFilters={setFilters} loading={!isAuthenticated||status==='LoadingFirstPage'||scanning||(filters.unused&&results.length===0&&status==='LoadingMore')} loadingMore={status==='LoadingMore'} hasMore={status==='CanLoadMore'} onLoadMore={()=>loadMore(20)} onDelete={(files,confirmedProjects)=>remove({fileIds:files.map(file=>file.id),confirmedProjects})}/></div>;
}

function StorageBrowser({summary,files,filters,onFilters,loading,loadingMore,hasMore,onLoadMore,onDelete}:{summary?:Summary;files:StorageFile[];filters:Filters;onFilters:(value:Filters)=>void;loading:boolean;loadingMore:boolean;hasMore:boolean;onLoadMore:()=>void;onDelete:(files:StorageFile[],confirmedProjects:Id<'projects'>[])=>Promise<Id<'projects'>[]>}){
  const router=useRouter(),createEdit=useMutation(api.storage.createEdit);
  const [creating,setCreating]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(()=>new Set()),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [deleting,setDeleting]=useState<Id<'projects'>[]|null>(null),[cleanupError,setCleanupError]=useState(''),[retrying,setRetrying]=useState(false);
  const {isAuthenticated}=useConvexAuth();
  const pending=useQuery(api.projects.pendingDeletions,isAuthenticated?{}:'skip');
  const cleanupProjects=[...new Set([...(deleting??[]),...(pending??[])])];
  const cleanup=useQuery(api.projects.deletionStatus,isAuthenticated&&cleanupProjects.length?{projectIds:cleanupProjects}:'skip');
  const retryDeletion=useMutation(api.projects.retryDeletion);
  const chosen=files.filter(file=>selected.has(file.id)&&file.canDelete),used=[...new Map(chosen.filter(file=>file.kind!=='export').flatMap(file=>file.workspaces).map(project=>[project.id,project])).values()],selectable=files.filter(file=>file.canDelete).slice(0,20);
  // The server also names projects the selection would leave with nothing in them; the rows cover the wait.
  const removed=useQuery(api.storage.deletedProjects,isAuthenticated&&confirm&&chosen.length?{fileIds:chosen.map(file=>file.id)}:'skip');
  const doomed=removed??used;
  const ready=summary?.ready;
  function changeFilters(patch:Partial<Filters>){setSelected(new Set());onFilters({...filters,...patch});}
  async function deleteFiles(){if(busy||!chosen.length)return;setBusy(true);setError('');try{const projects=await onDelete(chosen,doomed.map(project=>project.id));setDeleting(previous=>[...new Set([...(previous??[]),...projects])]);setCleanupError('');setSelected(new Set());setConfirm(false);}catch(reason){setError(userError(reason, 'Could not delete these files. Nothing from this attempt was removed. Please retry.'));}finally{setBusy(false);}}
  async function startEdit(items:StorageFile[]){if(creating||!items.length)return;setCreating(true);setError('');try{const projectId=await createEdit({fileIds:items.map(file=>file.id)});router.push(`/editor/${projectId}`);}catch(reason){setError(userError(reason,'Could not create this edit. Please retry.'));}finally{setCreating(false);}}
  async function retryCleanup(){if(!cleanupProjects.length||retrying)return;setRetrying(true);setCleanupError('');try{await retryDeletion({projectIds:cleanupProjects});}catch(reason){setCleanupError(userError(reason,'Cleanup could not finish. Please retry.'));}finally{setRetrying(false);}}
  return <main className="storage-content">
    <div className="storage-heading"><div><h1>Cloud storage</h1><p>Keep your media organized. Make room for your next edit.</p></div><div className="storage-heading-actions"><Button asChild variant="outline"><Link href={NEW_PROJECT_PATH}>New edit<ArrowUpRight size={14}/></Link></Button><CloudUpload disabled={!isAuthenticated} onUploaded={()=>changeFilters({kind:'all',search:'',unused:false,sort:'newest'})}/></div></div>
    {error&&!confirm&&<p className="workspace-inline-error" role="alert">{error}</p>}
    <section className="storage-usage" aria-label="Cloud storage usage" aria-busy={!ready}>
      <div className="storage-usage-top"><div><p>Storage used</p>{ready?<strong>{formatStorageBytes(summary.usedBytes)}</strong>:<Skeleton style={{height:28,width:185}}/>}</div>{ready?<span>No storage limit</span>:<Skeleton style={{height:13,width:115}}/>}</div>
      {/* No allowance to fill, so the bar shows how the used space splits by kind. */}
      <div className="storage-meter" aria-label="Storage used by kind">
        {breakdown.map(([field],index)=><span key={field} className={`storage-color-${index}`} style={{width:`${ready&&summary.usedBytes>0?summary[field]/summary.usedBytes*100:0}%`}}/>)}
      </div>
      <div className="storage-breakdown">{breakdown.map(([field,label],index)=><span key={field}><i className={`storage-color-${index}`}/>{label}<b>·</b>{ready?formatStorageBytes(summary[field]):<Skeleton as="span" style={{display:'inline-block',height:11,width:35}}/>}</span>)}</div>
      {ready&&summary.reservedBytes>0&&<UnfinishedUploads reservedBytes={summary.reservedBytes}/>}
    </section>
    {(deleting||cleanupProjects.length>0)&&<div className="storage-selection" role={cleanup==='failed'?'alert':'status'}><span>{cleanupError||(cleanup==='failed'?'Project cleanup stopped. Retry to finish removing its files.':cleanupProjects.length&&cleanup!=='complete'?'Finishing project cleanup…':'Deletion complete. Storage used is up to date.')}</span>{cleanup==='failed'&&<Button variant="outline" size="md" disabled={retrying} onClick={()=>void retryCleanup()}>{retrying?'Retrying…':'Retry cleanup'}</Button>}</div>}
    <section className="storage-library" aria-label="Stored media" aria-busy={loading}>
      <div className="storage-library-heading"><div><h2>All media</h2><p>{ready?`${summary.fileCount} ${summary.fileCount===1?'file':'files'} in your cloud library`:'Your media and exports'}</p></div><Button variant="outline" size="md" aria-pressed={filters.unused} onClick={()=>changeFilters({unused:!filters.unused})}>{filters.unused?'Show all media':'Review unused'}</Button></div>
      <div className="storage-toolbar"><div className="storage-search relative"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/><Input type="search" className="pl-8" aria-label="Search media" placeholder="Search media" value={filters.search} maxLength={120} onChange={event=>changeFilters({search:event.target.value})}/></div><Tabs className="storage-categories" value={filters.kind} onValueChange={value=>changeFilters({kind:value as Filters['kind']})}><TabsList aria-label="Media type">{categories.map(([value,label])=><TabsTrigger key={value} value={value}>{label}</TabsTrigger>)}</TabsList></Tabs><Button variant="ghost" size="md" className="storage-sort" aria-label="Change storage sorting" onClick={()=>changeFilters({sort:filters.sort==='largest'?'newest':'largest'})}>{filters.sort==='largest'?'Largest first':'Newest first'}<ArrowDown size={12}/></Button></div>
      {chosen.length>0&&<div className="storage-selection" role="status"><span>{chosen.length} selected · {formatStorageBytes(chosen.reduce((sum,file)=>sum+file.size,0))}</span><Button variant="outline" size="md" disabled={creating||chosen.some(file=>!file.canCreateEdit)} onClick={()=>void startEdit(chosen)}>{creating?<LoaderCircle size={13} className="animate-spin"/>:<Film size={13}/>}Create edit</Button><Button variant="outline" size="md" disabled={creating} onClick={()=>{setError('');setConfirm(true);}}><Trash2 size={13}/>Delete selected</Button></div>}
      <div className="storage-table-wrap"><Table className="storage-table"><TableHeader><TableRow><TableHead className="storage-check"><Checkbox aria-label="Select unused files on this page" disabled={!selectable.length||loading} checked={selectable.length>0&&selectable.every(file=>selected.has(file.id))} onCheckedChange={checked=>setSelected(checked===true?new Set(selectable.map(file=>file.id)):new Set())}/></TableHead><TableHead>Name</TableHead><TableHead className="storage-size">Size</TableHead><TableHead className="storage-added">Added</TableHead><TableHead><span className="storage-sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>
        {loading?Array.from({length:5},(_,index)=><TableRow key={index} aria-hidden="true" className="storage-skeleton-row"><TableCell className="storage-check"><Skeleton style={{width:14,height:14}}/></TableCell><TableCell><div className="storage-file"><Skeleton style={{width:38,height:38,flexShrink:0}}/><div style={{width:'70%'}}><Skeleton style={{height:12,width:'100%'}}/><Skeleton style={{height:9,width:'35%',marginTop:7}}/></div></div></TableCell><TableCell className="storage-size"><Skeleton style={{height:12,width:45}}/></TableCell><TableCell className="storage-added"><Skeleton style={{height:12,width:42}}/></TableCell><TableCell className="storage-row-action"><Skeleton style={{height:14,width:14}}/></TableCell></TableRow>):files.map(file=>{const Icon=icons[file.kind];return <TableRow key={file.id} data-file-id={file.id}><TableCell className="storage-check"><Checkbox aria-label={`Select ${file.fileName}`} disabled={!file.canDelete||(!selected.has(file.id)&&chosen.length>=20)} checked={file.canDelete&&selected.has(file.id)} onCheckedChange={checked=>setSelected(current=>{const next=new Set(current);if(checked===true)next.add(file.id);else next.delete(file.id);return next;})}/></TableCell><TableCell><div className={`storage-file storage-file-${file.kind}`}>{file.thumbnailUrl?<img className="storage-file-icon storage-file-thumb" src={file.thumbnailUrl} alt="" loading="lazy" decoding="async"/>:<span className="storage-file-icon"><Icon size={17}/></span>}<div><strong>{file.fileName}</strong><small>{categories.find(([key])=>key===file.kind)?.[1].replace('Images','Image').replace('Exports','Export')}{file.cloudOnly?' · Cloud upload':''}</small></div></div></TableCell><TableCell className="storage-size">{formatStorageBytes(file.size)}</TableCell><TableCell className="storage-added">{new Date(file.createdAt).toLocaleDateString(undefined,{month:'short',day:'2-digit'})}</TableCell><TableCell className="storage-row-action"><div className="storage-row-actions">{file.canCreateEdit&&<Button variant="ghost" size="md" disabled={creating} aria-label={`Create edit from ${file.fileName}`} onClick={()=>void startEdit([file])}>Create edit</Button>}{file.canDelete?<Button variant="ghost" size="icon" aria-label={`Delete ${file.fileName}`} onClick={()=>{setSelected(new Set([file.id]));setError('');setConfirm(true);}}><Trash2 size={14}/></Button>:file.workspaces[0]?<Button asChild variant="ghost" size="icon"><Link href={`/editor/${file.workspaces[0].id}`} aria-label={`Open workspace for ${file.fileName}`}><ArrowUpRight size={14}/></Link></Button>:<LockKeyhole size={13} aria-label={file.protectedReason??'Protected file'}/>}</div></TableCell></TableRow>;})}
      </TableBody></Table></div>
      {loading?<span className="storage-sr-only" role="status">Loading your media…</span>:!files.length&&<div className="storage-empty">{filters.unused?'No unused files in these results.':filters.search||filters.kind!=='all'?'No media matches your search.':'Your media and exports will appear here.'}</div>}
      {(hasMore||loadingMore)&&<div className="storage-load-more"><Button variant="outline" size="md" disabled={loadingMore} onClick={onLoadMore}>{loadingMore&&<LoaderCircle size={13} className="animate-spin"/>}{loadingMore?'Loading…':'Load more'}</Button></div>}
      <p className="storage-protection"><LockKeyhole size={12}/>Deleting media that a project uses, or the last media in a project with no clips, deletes that project too. Files stay locked only while an AI edit or export is running.</p>
    </section>
    <Dialog open={confirm} onOpenChange={open=>{if(!busy)setConfirm(open);}}><DialogContent className="workspace-dialog"><DialogTitle>Delete {chosen.length===1?'this file':`${chosen.length} files`}?</DialogTitle><DialogDescription>This permanently removes the selected media from your library.</DialogDescription>{doomed.length>0&&<div className="storage-delete-projects" role="note"><p>{doomed.length===1?'This project will be deleted too:':`These ${doomed.length} projects will be deleted too:`}</p><ul>{doomed.slice(0,5).map(project=><li key={project.id}>{project.title}</li>)}{doomed.length>5&&<li>and {doomed.length-5} more</li>}</ul></div>}<p className="storage-delete-size">{formatStorageBytes(chosen.reduce((sum,file)=>sum+file.size,0))} in selected files. Storage used updates as cleanup finishes.</p>{error&&<p className="workspace-inline-error" role="alert">{error}</p>}<div className="workspace-dialog-actions"><Button variant="outline" size="md" disabled={busy} onClick={()=>setConfirm(false)}>Cancel</Button><PrimaryButton disabled={busy||!chosen.length||removed===undefined} onClick={()=>void deleteFiles()}>{busy&&<LoaderCircle size={13} className="animate-spin"/>}{busy?'Deleting…':doomed.length?'Delete files and projects':'Delete files'}</PrimaryButton></div></DialogContent></Dialog>
  </main>;
}
