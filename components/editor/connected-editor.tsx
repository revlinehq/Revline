'use client';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useStore } from 'zustand';
import { createEditorStore } from '@/lib/editor/store';
import { createTimelineSaveQueue } from '@/lib/editor/timeline-sync';
import { EditorStateProvider } from './editor-state';
import { useConvex, useConvexAuth, useMutation, useQuery, useAction } from 'convex/react';
import { useUIMessages } from '@convex-dev/agent/react';
import { LoaderCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id, Doc } from '@/convex/_generated/dataModel';
import { EditorShell } from './editor-shell';
import { EditorAccessGate } from '@/components/workspace/editor-access-gate';
import { acknowledgeDraftFiles, takeFiles } from '@/components/workspace/project-draft';
import type { ChatMessage, ChatTool } from './assistant-panel';
import type { ExportSettings } from './export-dialog';
import { EMPTY_TIMELINE, type Timeline, type MediaAsset } from '@/lib/editor/types';
import { addMediaClip, separateVideoClips } from '@/lib/editor/operations';
import { prepareVideoAudio, prepareAudioWaveform } from '@/lib/editor/prepare-video-audio';
import { uploadSourceFile } from '@/lib/editor/upload-source';
import type { UploadProgress } from './footage-panel';
export function ConnectedEditor({projectId}: {projectId:string}) {
  const {isAuthenticated}=useConvexAuth();
  const project=useQuery(api.projects.get,isAuthenticated?{projectId:projectId as Id<'projects'>}:'skip');
  if(!project)return <div className="editor-boot"><LoaderCircle className="animate-spin"/><p>Opening your story…</p><Link href="/projects">Your projects</Link></div>;
  return <EditorAccessGate><ProjectEditor key={projectId} project={project}/></EditorAccessGate>;
}
function ProjectEditor({project}: {project:Doc<'projects'>}) {
  const projectId=project._id;const convex=useConvex();const media=useQuery(api.assets.list,{projectId,limit:200});const ai=useQuery(api.assistant.status,{projectId});
  const {results,status,loadMore}=useUIMessages(api.assistant.messages,project.threadId?{projectId,threadId:project.threadId}:'skip',{initialNumItems:20,stream:true});
  const save=useMutation(api.projects.saveTimeline);const update=useMutation(api.projects.update);const backendUndo=useMutation(api.projects.undo);const startUpload=useAction(api.r2.start);const partUrl=useAction(api.r2.partUrl);const finishUpload=useAction(api.r2.complete);const abortUpload=useAction(api.r2.abort);const send=useMutation(api.assistant.send);const stop=useMutation(api.assistant.stop);const renderStart=useMutation(api.renders.start);
  const importVideo=useMutation(api.mediaTasks.importVideo);
  const mediaTasks=useQuery(api.mediaTasks.list,{projectId});
  const jobs=useQuery(api.renders.list,{projectId,limit:5});const [jobId,setJobId]=useState<Id<'renderJobs'>|null>(null);const job=useQuery(api.renders.get,jobId?{jobId}:'skip');
  const [store]=useState(()=>createEditorStore(project.timeline??{...EMPTY_TIMELINE,aspectRatio:project.aspectRatio}));const timeline=useStore(store,s=>s.timeline);const history=useStore(store,s=>s.history);const future=useStore(store,s=>s.future);const timelineRef=useRef(timeline);const [saving,setSaving]=useState(false);const [error,setError]=useState('');const [title,setTitle]=useState(project.title);
  const [saves]=useState(()=>createTimelineSaveQueue({timeline,revision:project.revision??0},{
    save: edit=>save({projectId,...edit}),
    load: async()=>{const fresh=await convex.query(api.projects.get,{projectId});return {timeline:fresh.timeline??{...EMPTY_TIMELINE,aspectRatio:fresh.aspectRatio},revision:fresh.revision??0};},
    update: (next,kind)=>{timelineRef.current=next;if(kind==='recovered')store.getState().recover(next);else store.getState().replace(next,kind==='remote');},
    saving:setSaving,
    error:e=>setError(e instanceof Error?e.message:'Could not save this edit.'),
  }));
  const [upload,setUpload]=useState<UploadProgress>(null);const [optimisticAssets,setOptimisticAssets]=useState<MediaAsset[]>([]);
  useEffect(()=>{saves.receive({timeline:project.timeline??{...EMPTY_TIMELINE,aspectRatio:project.aspectRatio},revision:project.revision??0});},[project,saves]);
  const assets=useMemo<MediaAsset[]>(()=>[...(media??[]),...optimisticAssets.filter(asset=>!media?.some(a=>a._id===asset._id))],[media,optimisticAssets]);
  const commit=useCallback((next:Timeline)=>{timelineRef.current=next;store.getState().replace(next);saves.edit(next);},[saves]);
  const change=useCallback((next:Timeline)=>{store.getState().edit(next);setError('');commit(next);},[commit]);
  const undo=useCallback(()=>{const prev=store.getState().undo();if(prev){commit(prev);}else{void backendUndo({projectId}).catch(e=>setError(String(e)));}},[history,commit,backendUndo,projectId]);
  const redo=useCallback(()=>{const next=store.getState().redo();if(next){commit(next);}},[future,commit]);
  const preparingAudio=useRef<Promise<void>|null>(null);const failedAudio=useRef(new Set<string>());const [audioBusy,setAudioBusy]=useState(false);
  useEffect(()=>{
    if(media===undefined||ai===undefined||preparingAudio.current||audioBusy||ai.running||upload||uploading.current)return;
    const source=assets.find(asset=>asset.kind==='video'&&!failedAudio.current.has(asset._id)&&timeline.clips.some(clip=>clip.assetId===asset._id&&!clip.audioSeparated))??assets.find(asset=>asset.kind==='audio'&&!asset.waveform&&!failedAudio.current.has(asset._id)&&timeline.clips.some(clip=>clip.assetId===asset._id));
    if(!source)return;
    setAudioBusy(true);
    const task=(async()=>{
      if(source.kind==='audio'){
        await prepareAudioWaveform(convex,projectId,source._id as Id<'assets'>);
        failedAudio.current.add(source._id);
        return;
      }
      if(!source.audioExtracted)await prepareVideoAudio(convex,projectId,source._id as Id<'assets'>);
      const video=await convex.query(api.assets.get,{projectId,assetId:source._id as Id<'assets'>});
      if(video.audioAssetId){
        const audio=await convex.query(api.assets.get,{projectId,assetId:video.audioAssetId});
        setOptimisticAssets(previous=>[...previous.filter(a=>a._id!==video._id&&a._id!==audio._id),video,audio]);
        const next=separateVideoClips(timelineRef.current,video);
        if(next!==timelineRef.current){change(next);await saves.wait();}
        if(timelineRef.current.clips.some(clip=>clip.assetId===video._id&&!clip.audioSeparated))throw new Error('Could not save the separated audio. Try reopening this project.');
      }
      failedAudio.current.add(source._id);
    })().catch(e=>{failedAudio.current.add(source._id);setError(e instanceof Error?e.message:'Could not separate this video’s audio.');}).finally(()=>{preparingAudio.current=null;setAudioBusy(false);});
    preparingAudio.current=task;
  },[media,assets,timeline,ai?.running,upload,audioBusy,convex,projectId,change,saves]);
  const titleChange=async(value:string)=>{await update({projectId,title:value});setTitle(value);};
  const waitForSave=()=>saves.wait();
  const messages:ChatMessage[]=results.map(m=>({id:m.id,role:m.role,status:m.status,text:m.parts.filter(part=>part.type==='text').map(part=>'text'in part?String(part.text):'').join(''),steps:m.parts.flatMap(part=>{
    if(!part.type.startsWith('tool-')||!('state'in part))return [];
    const state:ChatTool['state']=part.state==='output-available'?'done':part.state==='output-error'?'error':'running';
    const output='output'in part&&typeof part.output==='object'&&part.output?part.output as Record<string,unknown>:null;
    const changed=Array.isArray(output?.changedClips)?output.changedClips.length:0;
    return [{name:part.type.replace(/^tool-/,''),state,detail:changed?`${changed} ${changed===1?'clip':'clips'} updated`:undefined}];
  })}));
  const uploading=useRef(false);
  async function handleUpload(files:File[],requireAll=false){
    if(uploading.current||!files.length)return;uploading.current=true;setError('');
    let incomplete=false;
    const queue = files.map(file => ({id:crypto.randomUUID(),name:file.name,percent:0,kind:(file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':'video') as 'video'|'image'|'audio',error:undefined as string|undefined}));
    try{await preparingAudio.current;for(const [index,file] of files.entries()){
      const progress={name:file.name,size:file.size,index:index+1,total:files.length};
      const report = (percent:number,phase:'reading'|'uploading'|'saving') => { queue[index].percent=percent; setUpload({...progress,percent,phase,queue:queue.slice(index).map(item=>({...item}))}); };
      try{
        const assetId = await uploadSourceFile(file, {
          start: meta => startUpload({ projectId, fileName: file.name, contentType: file.type, size: file.size, ...meta }),
          partUrl: (uploadId, partNumber) => partUrl({ uploadId, partNumber }),
          complete: (uploadId, parts) => finishUpload({ uploadId, parts }),
          abort: uploadId => abortUpload({ uploadId }),
        }, report);
        let asset=await convex.query(api.assets.get,{projectId,assetId});
        if(asset.kind==='video'&&!asset.audioExtracted){await prepareVideoAudio(convex,projectId,assetId);asset=await convex.query(api.assets.get,{projectId,assetId});}
        if(asset.kind==='audio'&&!asset.waveform){await prepareAudioWaveform(convex,projectId,assetId);asset=await convex.query(api.assets.get,{projectId,assetId});}
        const audio=asset.audioAssetId?await convex.query(api.assets.get,{projectId,assetId:asset.audioAssetId}):null;
        setOptimisticAssets(previous=>[...previous,asset,...(audio?[audio]:[])]);change(addMediaClip(timelineRef.current,asset,crypto.randomUUID()));
        await waitForSave();
        if(!timelineRef.current.clips.some(clip=>clip.assetId===assetId))throw new Error('Your footage uploaded, but its clip could not be saved. Please retry the import.');
        await acknowledgeDraftFiles([file]);
      }catch(e){incomplete=true;setError(e instanceof Error?e.message:'Could not import this file.');}
    }}finally{uploading.current=false;setUpload(null);}
    if(requireAll&&incomplete)throw new Error('Some footage could not be imported. Your request is still saved; retry the missing files before starting the edit.');
  }
  async function exportVideo(settings:ExportSettings){if(saves.busy)throw new Error('Wait for your changes to finish saving.');const id=await renderStart({projectId,...settings});setJobId(id);}
  const activeTask=mediaTasks?.find(task=>task.kind!=='render'&&['queued','running','retrying'].includes(task.status));
  const taskLabels={import:'Importing your video…',extract:'Preparing audio…',waveform:'Preparing waveform…',track:'Following face…',transcribe:'Listening to your footage…',beats:'Finding the rhythm…',shots:'Finding shot changes…',understand:'Watching your footage…',render:'Exporting video…'};
  const analysisBusy=activeTask?taskLabels[activeTask.kind]:null;
  const exportState=job??jobs?.[0]??null;
  const handoffStarted=useRef(false);
  useEffect(()=>{
    if(handoffStarted.current||media===undefined)return;
    handoffStarted.current=true;
    void(async()=>{
      const files=await takeFiles();
      if(files.length)await handleUpload(files,true);
      await waitForSave();
      const prompt=sessionStorage.getItem('revline:brief:'+projectId);
      if(prompt&&timelineRef.current.clips.length&&!saves.busy){await send({projectId,prompt});sessionStorage.removeItem('revline:brief:'+projectId);}
    })().catch(e=>setError(e instanceof Error?e.message:'Could not start this edit.'));
  },[media,projectId,send]);
  if(media===undefined)return <div className="editor-boot"><LoaderCircle className="animate-spin"/><p>Loading your footage…</p></div>;
  return <EditorStateProvider store={store}><EditorShell projectId={projectId} draftKey={`revline:editor-draft:${projectId}`} title={title} onTitle={titleChange} timeline={timeline} assets={assets} onChange={change} saving={saving} upload={upload} error={error} onError={setError} onUndo={undo} onRedo={redo} canUndo={!!history.length||!!project.history?.length} canRedo={!!future.length} messages={messages} aiRunning={ai?.running??false} aiConfigured={ai?.configured??false} aiError={ai?.error} onStop={async()=>{await stop({projectId});}} onSend={async(prompt,context)=>{await preparingAudio.current;await waitForSave();await send({projectId,prompt,...context});}} onExport={exportVideo} exportState={exportState} onUpload={handleUpload} onImportVideo={async url=>{await waitForSave();await importVideo({projectId,url});}} videoImports={mediaTasks?.filter(task=>task.kind==='import')} analysisBusy={analysisBusy??(audioBusy?'Preparing audio…':null)} canLoadMore={status==='CanLoadMore'} onLoadMore={()=>loadMore(20)}/></EditorStateProvider>;
}
