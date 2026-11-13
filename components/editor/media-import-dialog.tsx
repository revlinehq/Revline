'use client';

import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react';
import { ChevronRight, Folder, HardDrive, LoaderCircle, Upload, Film, Image as ImageIcon, Music2, Box } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { VideoFrame } from '@/components/media/video-frame';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AddMediaUpload } from '@/components/media/add-media-upload';
import { userError } from '@/lib/user-error';
import { formatTime, type MediaAsset } from '@/lib/editor/types';
import { MediaThumbnail } from './media-thumbnail';
import './media-import-dialog.css';

type FolderId = Id<'storageFolders'>;
type Folder = { id: FolderId; name: string; parentId: FolderId | null };
/** `upload`, the Library root (`storage`), or one Library folder. */
type Section = 'upload' | 'storage' | FolderId;
const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
/** Files `library.addToProject` takes in one call. */
const ADD_LIMIT = 20;

/** The editor's Add media dialog. Left: Upload, then Media storage with the Library's folders under it. Right: the
 * shared Upload page (drop zone and Paste URL), or the chosen Library folder's media to pick and add to this project. */
export function MediaImportDialog({ open, onOpenChange, onUpload, onImportVideo, disabled=false, projectMedia=[], onPickProjectMedia, projectId }: {
  open:boolean; onOpenChange:(open:boolean)=>void; onUpload:(files:File[])=>void;
  onImportVideo?:(url:string)=>Promise<void>; disabled?:boolean;
  /** Media already in the project that can go out with the message instead of uploading it again. */
  projectMedia?:MediaAsset[]; onPickProjectMedia?:(asset:MediaAsset)=>void;
  /** Shows Media storage: Library files picked there are added to this project. */
  projectId?:string;
}) {
  const [section,setSection]=useState<Section>('upload');
  // While a link import is starting the dialog stays open, so its answer or error is seen.
  const [linkBusy,setLinkBusy]=useState(false);
  const busy=disabled;
  function attach(files:File[]) {
    if(busy||!files.length)return;
    onOpenChange(false);onUpload(files);
  }
  return <Dialog open={open} onOpenChange={value=>{if(!value&&linkBusy)return;if(!value)setSection('upload');onOpenChange(value);}}>
    <DialogContent className="media-import-dialog add-media-dialog" data-storage={projectId?'':undefined} onDragEnter={event=>{
      if(hasFiles(event))event.stopPropagation();
    }} onDragOver={event=>{
      if(!hasFiles(event))return;
      event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=busy?'none':'copy';if(!busy)setSection('upload');
    }} onDragLeave={event=>event.stopPropagation()} onDrop={event=>{
      if(!hasFiles(event))return;
      event.preventDefault();event.stopPropagation();attach(Array.from(event.dataTransfer.files));
    }}>
      <DialogTitle className="sr-only">Add media</DialogTitle>
      <DialogDescription className="sr-only">Upload files, paste a video link{projectId?', or add media from your storage':''}.</DialogDescription>
      <div className="add-media-layout">
        <nav className="add-media-nav" aria-label="Add media from">
          <Button type="button" variant="ghost" aria-current={section==='upload'?'page':undefined} onClick={()=>setSection('upload')}><Upload/>Upload</Button>
          {projectId&&<StorageNav section={section} onSection={setSection}/>}
        </nav>
        <div className="add-media-main">
          {section==='upload'?<>
            {onPickProjectMedia&&projectMedia.length>0&&<div className="media-import-project" role="list" aria-label="Media in this project">{projectMedia.map(asset=><button key={asset._id} type="button" role="listitem" className="media-import-project-item" title={asset.fileName} aria-label={`Attach ${asset.fileName}`} onClick={()=>{onOpenChange(false);onPickProjectMedia(asset);}}><MediaThumbnail asset={asset}/><span>{asset.fileName}</span></button>)}</div>}
            <AddMediaUpload layout="stacked" place="this project" disabled={busy} onBusyChange={setLinkBusy} onUpload={attach} onDone={()=>onOpenChange(false)}
              onImportLink={onImportVideo??(async()=>{throw new Error('Video links can be imported once the current edit finishes.');})}/>
          </>:projectId&&<StoragePicker key={section} projectId={projectId as Id<'projects'>} folderId={section==='storage'?undefined:section} onAdded={()=>onOpenChange(false)}/>}
        </div>
      </div>
    </DialogContent>
  </Dialog>;
}

/** Media storage (the Library root) with every folder nested under its parent. */
function StorageNav({ section, onSection }: { section: Section; onSection: (section: Section) => void }) {
  const folders=useQuery(api.library.folderTree,{});
  const children=useMemo(()=>{
    const map=new Map<FolderId|null,Folder[]>();
    for(const folder of folders??[]){const list=map.get(folder.parentId)??[];list.push(folder);map.set(folder.parentId,list);}
    return map;
  },[folders]);
  const branch=(parent:FolderId|null,depth:number):ReactNode=>(children.get(parent)??[]).map(folder=><div key={folder.id} role="none">
    <Button type="button" variant="ghost" className="add-media-folder" style={{'--depth':depth} as CSSProperties} aria-current={section===folder.id?'page':undefined} title={folder.name} onClick={()=>onSection(folder.id)}><Folder/><span>{folder.name}</span></Button>
    {branch(folder.id,depth+1)}
  </div>);
  return <>
    <Button type="button" variant="ghost" aria-current={section==='storage'?'page':undefined} onClick={()=>onSection('storage')}><HardDrive/>Media storage</Button>
    <div className="add-media-folders" role="group" aria-label="Folders">
      {folders===undefined?<span className="add-media-nav-note"><LoaderCircle className="animate-spin"/>Loading folders</span>:branch(null,1)}
    </div>
  </>;
}

const KIND_ICON = { video: Film, audio: Music2, image: ImageIcon, model: Box, export: Film } as const;

/** One Library folder's files (the root's own files for Media storage). Pick up to 20 and add them to the project. */
function StoragePicker({ projectId, folderId, onAdded }: { projectId: Id<'projects'>; folderId?: FolderId; onAdded: () => void }) {
  const { results, status, loadMore } = usePaginatedQuery(api.library.files, { sort: 'newest', ...(folderId ? { folderId } : {}) }, { initialNumItems: 40 });
  const folders = useQuery(api.library.folderTree, {});
  const addToProject = useMutation(api.library.addToProject);
  const [picked, setPicked] = useState<Id<'storageObjects'>[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const name = folderId ? folders?.find(folder => folder.id === folderId)?.name ?? 'Folder' : 'Media storage';
  const toggle = (id: Id<'storageObjects'>) => { setError(''); setPicked(previous => previous.includes(id) ? previous.filter(item => item !== id) : previous.length >= ADD_LIMIT ? previous : [...previous, id]); };
  async function add() {
    if (!picked.length || adding) return;
    setAdding(true); setError('');
    try {
      const result = await addToProject({ projectId, fileIds: picked });
      if (!result.added) setError(picked.length === 1 ? 'That file is already in this project.' : 'Those files are already in this project.');
      else onAdded();
    }
    catch (caught) { setError(userError(caught, 'Could not add this media to the project.')); }
    finally { setAdding(false); }
  }
  return <div className="add-media-storage">
    <header><strong>{name}</strong>{picked.length>0&&<span>{picked.length} selected{picked.length>=ADD_LIMIT?` · up to ${ADD_LIMIT} at a time`:''}</span>}</header>
    {status==='LoadingFirstPage'?<p className="add-media-storage-note"><LoaderCircle className="animate-spin"/>Loading media</p>
      :!results.length?<p className="add-media-storage-note">{folderId?'This folder has no media.':'No media at the top of your storage. Open a folder on the left.'}</p>
      :<div className="add-media-grid" role="list" aria-label={`Media in ${name}`}>
        {results.map(file=>{
          const blocked=file.kind==='export'||file.kind==='model';
          const selected=picked.includes(file.id);
          const Icon=KIND_ICON[file.kind];
          const reason=blocked?(file.kind==='export'?'Exports cannot be added to a project':'3D models cannot be added'):'';
          return <div key={file.id} role="listitem" className="add-media-file" data-selected={selected||undefined} data-blocked={blocked||undefined} title={reason?`${file.fileName} · ${reason}`:file.fileName}>
            <Button type="button" variant="ghost" className="add-media-file-hit" disabled={blocked} aria-pressed={selected} aria-label={reason?`${file.fileName}: ${reason}`:`${selected?'Deselect':'Select'} ${file.fileName}`} onClick={()=>toggle(file.id)}>
              <span className="add-media-file-thumb">{file.thumbnailUrl?<img src={file.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={false}/>:file.videoUrl?<VideoFrame key={file.videoUrl} src={file.videoUrl} fallback={<Icon/>}/>:<Icon/>}
                {file.duration!==null&&<span className="add-media-file-duration">{formatTime(file.duration)}</span>}</span>
              <span className="add-media-file-name">{file.fileName}</span>
            </Button>
            {!blocked&&<Checkbox className="add-media-file-check" checked={selected} aria-label={`Select ${file.fileName}`} onCheckedChange={()=>toggle(file.id)}/>}
          </div>;
        })}
      </div>}
    {status==='CanLoadMore'&&<Button type="button" variant="ghost" size="sm" className="add-media-more" onClick={()=>loadMore(40)}>Show more<ChevronRight/></Button>}
    {error&&<p className="add-media-error" role="alert">{error}</p>}
    <footer><Button type="button" disabled={!picked.length||adding} onClick={()=>void add()}>{adding&&<LoaderCircle className="animate-spin"/>}{picked.length?`Add ${picked.length} to project`:'Add to project'}</Button></footer>
  </div>;
}
