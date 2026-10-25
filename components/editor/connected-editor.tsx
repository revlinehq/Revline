'use client';
import { userError } from '@/lib/user-error';
import { NEW_WORKSPACE_LABEL } from '@/lib/editor/workspace-labels';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import { createEditorStore } from '@/lib/editor/store';
import { createTimelineSaveQueue } from '@/lib/editor/timeline-sync';
import { EditorStateProvider } from './editor-state';
import { useConvex, useConvexAuth, useMutation, useQuery, useAction } from 'convex/react';
import { openingFootage } from '@/lib/editor/footage-opening';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import { FootagePreparation } from './footage-preparation';
import { api } from '@/convex/_generated/api';
import type { Id, Doc } from '@/convex/_generated/dataModel';
import { EditorShell } from './editor-shell';
import { ConnectedTimelineShareDialog } from './timeline-share-dialog';
import { EditorAccessGate } from '@/components/workspace/editor-access-gate';
import { acknowledgeDraftFiles, takeFiles } from '@/components/workspace/project-draft';
import type { ChatMessage } from './assistant-panel';
import { matchesUndoSnapshot, type AssistantEditSnapshot } from './assistant-results';
import type { ExportSettings } from './export-dialog';
import { EMPTY_TIMELINE, normalizeTimeline, type Timeline, type MediaAsset } from '@/lib/editor/types';
import { addMediaClip, separateVideoClips } from '@/lib/editor/operations';
import { prepareVideoAudio, prepareAudioWaveform } from '@/lib/editor/prepare-video-audio';
import { prepareMediaForEditing } from '@/lib/editor/prepare-media-for-editing';
import { MEDIA_ACTIVITY_LABELS } from '@/lib/media-analysis/activity';
import { createPlaybackOpeningGate } from '@/lib/editor/editor-opening';
import { isCasualChat } from '@/lib/editor/chat-request';
import { uploadSourceFile } from '@/lib/editor/upload-source';
import { uploadMediaThumbnail } from '@/lib/editor/upload-thumbnail';
import { composerMedia } from '@/lib/editor/composer-media';
import type { UploadProgress } from './footage-panel';
const EMPTY_MESSAGES:ChatMessage[]=[];
function editorLoading(projectId: string) {
  const hint = openingFootage(projectId);
  return <div className="editor-app footage-preparation-boot"><WorkspaceNav title={NEW_WORKSPACE_LABEL}/><FootagePreparation thumbnail={hint?.thumbnail} fileName={hint?.fileName}/></div>;
}
export function ConnectedEditor({projectId}: {projectId:string}) {
  const {isAuthenticated}=useConvexAuth();
  const project=useQuery(api.projects.get,isAuthenticated?{projectId:projectId as Id<'projects'>,includeHistory:false}:'skip');
  const history=useQuery(api.projects.history,isAuthenticated?{projectId:projectId as Id<'projects'>}:'skip');
  if(!project||history===undefined)return editorLoading(projectId);
  return <EditorAccessGate loading={editorLoading(projectId)}><ProjectEditor key={projectId} project={{...project,history}}/></EditorAccessGate>;
}
function ProjectEditor({project}: {project:Doc<'projects'>}) {
  const [shareOpen,setShareOpen]=useState(false);
  const projectId=project._id;const convex=useConvex();const media=useQuery(api.assets.list,{projectId,limit:200});const plan=useQuery(api.billing.status,{})?.plan;const ai=useQuery(api.assistant.status,{projectId});
  const livePreview=useQuery(api.assistant.livePreview,ai?.running?{projectId}:'skip');
  const activePreview=ai?.running&&livePreview?.runId===project.aiRunId&&livePreview?.baseRevision===(project.revision??0)?livePreview:null;
  const save=useMutation(api.projects.saveTimeline);const update=useMutation(api.projects.update);const startUpload=useAction(api.r2.start);const partUrl=useAction(api.r2.partUrl);const finishUpload=useAction(api.r2.complete);const abortUpload=useAction(api.r2.abort);const send=useMutation(api.assistant.send);const stop=useMutation(api.assistant.stop);const renderStart=useMutation(api.renders.start);const renderCancel=useMutation(api.renders.cancel);const downloadExport=useAction(api.renders.download);
  const importVideo=useMutation(api.mediaTasks.importVideo);
  const removeAsset=useMutation(api.assets.remove);
  const registerStockAudio=useMutation(api.assets.registerStockAudio);
  const thumbnailUpload=useMutation(api.assets.generateUploadUrl);const attachThumbnail=useMutation(api.assets.attachThumbnail);
  const saveThumbnail=useCallback((assetId:Id<'assets'>,image:Blob)=>uploadMediaThumbnail(image,{
    uploadUrl:()=>thumbnailUpload({projectId}),attach:storageId=>attachThumbnail({assetId,storageId}),
  }),[thumbnailUpload,attachThumbnail,projectId]);
  const capturedThumbnails=useRef(new Set<string>());
  const persistThumbnail=useCallback((assetId:string,url:string)=>{
    if(capturedThumbnails.current.has(assetId))return;capturedThumbnails.current.add(assetId);
    void fetch(url).then(response=>response.blob()).then(image=>saveThumbnail(assetId as Id<'assets'>,image)).catch(()=>capturedThumbnails.current.delete(assetId));
  },[saveThumbnail]);
  const refreshMedia=useAction(api.playback.refresh);
  const preparePlayback=useMutation(api.playback.prepare);
  const handleRefreshMedia=useCallback((assetIds:string[])=>refreshMedia({projectId,assetIds:assetIds as Id<'assets'>[]}),[refreshMedia,projectId]);
  const mediaTasks=useQuery(api.mediaTasks.list,{projectId});
  const jobs=useQuery(api.renders.list,{projectId,limit:5});const [jobId,setJobId]=useState<Id<'renderJobs'>|null>(null);const job=useQuery(api.renders.get,jobId?{jobId}:'skip');
  const [store]=useState(()=>createEditorStore(project.timeline??{...EMPTY_TIMELINE,aspectRatio:project.aspectRatio},project.history??[]));const timeline=useStore(store,s=>s.timeline);const history=useStore(store,s=>s.history);const future=useStore(store,s=>s.future);const timelineRef=useRef(timeline);const [saving,setSaving]=useState(false);const [saveFailed,setSaveFailed]=useState(false);const [error,setError]=useState('');const [title,setTitle]=useState(project.title);
  useEffect(()=>{setTitle(project.title);},[project.title]);
  const [saves]=useState(()=>createTimelineSaveQueue({timeline,revision:project.revision??0,history:project.history??[]},{
    save: edit=>save({projectId,...edit}),
    load: async()=>{const fresh=await convex.query(api.projects.get,{projectId});return {timeline:fresh.timeline??{...EMPTY_TIMELINE,aspectRatio:fresh.aspectRatio},revision:fresh.revision??0,history:fresh.history??[]};},
    update: (next,kind,history)=>{timelineRef.current=next;store.getState().replace(next,kind==='remote'?history??true:false);},
    saving:setSaving,failed:setSaveFailed,
    error:(e,rejected)=>setError(rejected?`This edit couldn’t be saved and was undone. ${userError(e,'')}`.trim():userError(e, 'Could not save this edit.')),
  }));
  useEffect(()=>{
    // Unsaved edits retry with backoff; reconnecting retries at once.
    const retry=()=>saves.retry(),warn=(event:BeforeUnloadEvent)=>{if(!saves.busy&&!uploading.current)return;event.preventDefault();event.returnValue='';};
    window.addEventListener('online',retry);window.addEventListener('beforeunload',warn);
    return()=>{window.removeEventListener('online',retry);window.removeEventListener('beforeunload',warn);};
  },[saves]);
  const [composerAssetIds,setComposerAssetIds]=useState<string[]>([]);
  const [composerImportIds,setComposerImportIds]=useState<string[]>([]);
  useEffect(()=>{
    const completed=(mediaTasks??[]).filter(task=>composerImportIds.includes(task._id)&&task.status==='completed'&&task.assetId);
    if(!completed.length)return;
    setComposerAssetIds(previous=>[...new Set([...previous,...completed.map(task=>task.assetId!)])]);
    setComposerImportIds(previous=>previous.filter(id=>!completed.some(task=>task._id===id)));
  },[mediaTasks,composerImportIds]);
  const [upload,setUpload]=useState<UploadProgress>(null);const [uploadToComposer,setUploadToComposer]=useState(false);const [optimisticAssets,setOptimisticAssets]=useState<MediaAsset[]>([]);
  useEffect(()=>{if(ai?.workflowActive===false)saves.retry();},[ai?.workflowActive,saves]);
  useEffect(()=>{saves.receive({timeline:project.timeline??{...EMPTY_TIMELINE,aspectRatio:project.aspectRatio},revision:project.revision??0,history:project.history??[]});},[project,saves]);
  const assets=useMemo<MediaAsset[]>(()=>[...(media??[]),...optimisticAssets.filter(asset=>!media?.some(a=>a._id===asset._id))].map((asset:MediaAsset)=>{
    const analysis=mediaTasks?.find(task=>task.assetId===asset._id&&(task.kind==='understand'&&!asset.analysisKinds?.includes('understand')&&!asset.analysis?.understanding||task.kind==='transcribe'&&!asset.analysisKinds?.includes('transcribe')&&!asset.analysis?.transcript));
    if(analysis&&analysis.status!=='completed'){
      const failed=analysis.status==='failed'||analysis.status==='cancelled';
      return {...asset,preparation:{status:failed?'failed' as const:'processing' as const,message:failed?'Media analysis failed. Retry preparation.':analysis.activity?MEDIA_ACTIVITY_LABELS[analysis.activity]:analysis.kind==='transcribe'?'Listening to your footage…':'Watching your footage…'}};
    }
    if(asset.kind!=='video'||asset.audioExtracted||asset.audioAssetId)return asset;
    const task=mediaTasks?.find(task=>task.kind==='extract'&&task.assetId===asset._id);
    const failed=task?.status==='failed'||task?.status==='cancelled';
    return {...asset,preparation:{status:failed?'failed' as const:'processing' as const,message:failed?'Audio preparation failed.':'Preparing audio…'}};
  }),[media,optimisticAssets,mediaTasks]);
  const requestedPreviews=useRef(new Set<string>());
  const [previewPreparationError,setPreviewPreparationError]=useState('');
  const [playbackOpeningGate]=useState(createPlaybackOpeningGate);
  useEffect(()=>{
    const used=new Set((activePreview?.timeline??timeline).clips.filter(clip=>clip.kind==='video').map(clip=>clip.assetId));
    const legacy=assets.filter(asset=>asset.kind==='video'&&used.has(asset._id)&&!asset.previewUrl&&!requestedPreviews.current.has(asset._id)).map(asset=>asset._id);
    if(!legacy.length)return;
    for(const id of legacy)requestedPreviews.current.add(id);
    void preparePlayback({projectId,assetIds:legacy as Id<'assets'>[]}).catch(()=>{
      // Mounted sessions keep their source while preparation retries. An initial
      // large source waits below; this is not a failed upload or saved edit.
      console.warn('[Revline playback preparation]',JSON.stringify({reason:'background preview preparation unavailable',sources:legacy.length}));
      setPreviewPreparationError('Could not prepare this footage for editing. Your original footage and saved edit are intact.');
    });
  },[assets,timeline,activePreview?.timeline,preparePlayback,projectId]);
  const commit=useCallback((next:Timeline,undo=false)=>{timelineRef.current=next;if(store.getState().timeline!==next)store.getState().replace(next);saves.edit(next,undo,undo?store.getState().history:undefined);},[saves]);
  const change=useCallback((next:Timeline)=>{store.getState().edit(next);setError('');commit(store.getState().timeline);},[commit]);
  // The store starts with the complete bounded server history. Falling back to
  // server undo after consuming it would replay snapshots created by local undo.
  const undo=useCallback(()=>{const previous=store.getState().undo();if(previous)commit(previous,true);},[store,commit]);
  const redo=useCallback(()=>{const next=store.getState().redo();if(next)commit(next);},[store,commit]);
  const assistantEditSnapshot=useMemo<AssistantEditSnapshot|undefined>(()=>{
    const before=project.history?.at(-1);if(!before)return undefined;
    const after=normalizeTimeline(project.timeline??{...EMPTY_TIMELINE,aspectRatio:project.aspectRatio});
    const snapshot={before:normalizeTimeline(before),after,revision:project.revision??0};
    return {...snapshot,canUndo:!saving&&!ai?.running&&history.length>0&&matchesUndoSnapshot(snapshot,timeline,history.at(-1)??before),publishedDraft:!ai?.running&&project.aiUndoRecorded===true&&project.aiCheckpointRevision===snapshot.revision};
  },[project.history,project.timeline,project.aspectRatio,project.revision,project.aiUndoRecorded,project.aiCheckpointRevision,timeline,history,saving,ai?.running]);
  const aiStarting=useRef(false);
  const preparingAudio=useRef<Promise<void>|null>(null);const failedAudio=useRef(new Set<string>());const [audioBusy,setAudioBusy]=useState(false);
  useEffect(()=>{
    if(media===undefined||ai===undefined||aiStarting.current||preparingAudio.current||audioBusy||ai.running||upload||uploading.current)return;
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
    })().catch(e=>{failedAudio.current.add(source._id);setError(userError(e, 'Could not separate this video’s audio.'));}).finally(()=>{preparingAudio.current=null;setAudioBusy(false);});
    preparingAudio.current=task;
  },[media,assets,timeline,ai?.running,upload,audioBusy,convex,projectId,change,saves]);
  const titleChange=async(value:string)=>{await update({projectId,title:value});setTitle(value);};
  const waitForSave=()=>saves.wait();
  const sendRequest=async(prompt:string,context:Omit<Parameters<typeof send>[0],'projectId'|'prompt'>&{retry?:boolean}={})=>{
    aiStarting.current=true;
    const {retry,...requestContext}=context;
    const attached=retry?[]:[...composerAssetIds];
    try{if(!ai?.running&&!isCasualChat(prompt)){await preparingAudio.current;await waitForSave();}await send({projectId,prompt,...requestContext,...(attached.length?{attachedAssetIds:attached as Id<'assets'>[]}: {})});setComposerAssetIds(previous=>previous.filter(id=>!attached.includes(id)));}
    finally{aiStarting.current=false;}
  };

  const uploading=useRef(false);
  async function handleUpload(files:File[],{requireAll=false,addToTimeline=true,attach=addToTimeline}:{requireAll?:boolean;addToTimeline?:boolean;attach?:boolean}={}){
    if(uploading.current||!files.length)return;uploading.current=true;setUploadToComposer(attach);setError('');
    const failed=(file:File,e:unknown)=>{console.error(`[upload] ${file.name} failed`,e);setError(userError(e,`Could not import “${file.name}”. Please try adding it again.`));};
    let incomplete=false;
    // Cancel stops the current and remaining transfers; finished sources stay.
    const cancellation=new AbortController();
    const cancel=()=>cancellation.abort(new DOMException('Upload cancelled.','AbortError'));
    const queue = files.map(file => ({id:crypto.randomUUID(),name:file.name,percent:0,kind:(file.type.startsWith('audio/')?'audio':file.type.startsWith('image/')?'image':'video') as 'video'|'image'|'audio',error:undefined as string|undefined}));
    const transferred:{file:File;index:number;assetId:Id<'assets'>}[]=[];
    const report=(index:number,percent:number,phase:NonNullable<UploadProgress>['phase'])=>{
      const file=files[index];queue[index].percent=percent;
      setUpload({name:file.name,size:file.size,index:index+1,total:files.length,percent,phase,queue:queue.slice(index).map(item=>({...item})),...(phase==='reading'||phase==='uploading'?{onCancel:cancel}:{})});
    };
    try{
      // Completion starts durable preparation on the server. Transfer the next
      // source while those tasks run instead of waiting for each AI analysis.
      for(const [index,file] of files.entries()){
        if(cancellation.signal.aborted){incomplete=true;break;}
        try{
          const assetId=await uploadSourceFile(file,{
            start:meta=>startUpload({projectId,fileName:file.name,contentType:file.type,size:file.size,...meta}),
            partUrl:(uploadId,partNumber)=>partUrl({uploadId,partNumber}),
            complete:(uploadId,parts)=>finishUpload({uploadId,parts}),
            abort:uploadId=>abortUpload({uploadId}),saveThumbnail,
          },(percent,phase)=>report(index,percent,phase),cancellation.signal);
          transferred.push({file,index,assetId});
        }catch(e){incomplete=true;if(!cancellation.signal.aborted)failed(file,e);}
      }
      // Cancelled files must not resume from the local draft on the next open.
      if(cancellation.signal.aborted)await acknowledgeDraftFiles(files.filter(file=>!transferred.some(item=>item.file===file))).catch(()=>undefined);
      // Keep timeline writes ordered, and acknowledge each local draft only
      // after its preparation and requested timeline attachment have succeeded.
      for(const {file,index,assetId} of transferred){
        report(index,100,'saving');
        try{
          let asset:MediaAsset=await convex.query(api.assets.get,{projectId,assetId});
          if(asset.kind!=='image')asset=await prepareMediaForEditing(convex,projectId,assetId,status=>{
            report(index,100,status.phase==='processing'?'preparing':status.phase);
            setUpload(current=>current?{...current,activity:status.activity}:current);
          });
          const audio=asset.audioAssetId?await convex.query(api.assets.get,{projectId,assetId:asset.audioAssetId as Id<'assets'>}):null;
          setOptimisticAssets(previous=>[...previous.filter(item=>item._id!==asset._id&&item._id!==audio?._id),asset,...(audio?[audio]:[])]);
          if(attach)setComposerAssetIds(previous=>[...new Set([...previous,asset._id])]);
          if(addToTimeline){
            change(addMediaClip(timelineRef.current,asset,crypto.randomUUID()));
            await waitForSave();
            if(!timelineRef.current.clips.some(clip=>clip.assetId===assetId))throw new Error('Your footage uploaded, but its clip could not be saved. Please retry the import.');
          }
          await acknowledgeDraftFiles([file]);
        }catch(e){incomplete=true;failed(file,e);}
      }
    }finally{uploading.current=false;setUpload(null);setUploadToComposer(false);}
    if(requireAll&&cancellation.signal.aborted)throw new Error('Upload cancelled. Your request is still saved; add your footage when you’re ready to start the edit.');
    if(requireAll&&incomplete)throw new Error('Some footage could not be imported. Your request is still saved; retry the missing files before starting the edit.');
  }
  async function exportVideo(settings:ExportSettings){await saves.wait();const id=await renderStart({projectId,...settings});setJobId(id);}
  const latestExport=job??jobs?.[0]??null;
  const exportState=latestExport?{...latestExport,current:latestExport.sourceRevision===(project.revision??0)&&!saves.busy,requestId:latestExport._id}:null;
  const handoffStarted=useRef(false);
  useEffect(()=>{
    if(handoffStarted.current||media===undefined)return;
    handoffStarted.current=true;
    void(async()=>{
      const files=await takeFiles();
      if(files.length)await handleUpload(files,{requireAll:true});
      await waitForSave();
      const prompt=sessionStorage.getItem('revline:brief:'+projectId);
      if(prompt&&timelineRef.current.clips.length&&!saves.busy){await sendRequest(prompt);sessionStorage.removeItem('revline:brief:'+projectId);}
    })().catch(e=>setError(userError(e, 'Could not start this edit.')));
  },[media,projectId,send]);
  if(media===undefined)return editorLoading(projectId);
  const pendingPlayback=playbackOpeningGate(activePreview?.timeline??timeline,assets);
  if(pendingPlayback.length){
    const tasks=pendingPlayback.map(asset=>mediaTasks?.find(task=>task.kind==='preview'&&task.assetId===asset._id));
    const failed=tasks.some(task=>task?.status==='failed'||task?.status==='cancelled');
    const task=tasks.find(task=>task?.status==='running')??tasks[0];
    const error=previewPreparationError||(failed?'Could not prepare this footage for editing. Your original footage and saved edit are intact.':'');
    return <div className="editor-app footage-preparation-boot"><WorkspaceNav title={title}/><FootagePreparation thumbnail={pendingPlayback[0].thumbnailUrl??openingFootage(projectId)?.thumbnail} fileName={pendingPlayback[0].fileName} label="Preparing playback…" activity={task?.status==='queued'?'Queued for playback preparation…':'Optimizing footage for smooth editing…'} detail="Your footage is saved. The editor opens when its editing preview is ready." error={error} onRetry={error?()=>{setPreviewPreparationError('');void preparePlayback({projectId,assetIds:pendingPlayback.map(asset=>asset._id as Id<'assets'>)}).catch(()=>setPreviewPreparationError('Could not prepare this footage for editing. Your original footage and saved edit are intact.'));}:undefined}/></div>;
  }
  return <EditorStateProvider store={store}><EditorShell ultra={plan==='ultra'} onRegisterStockAudio={async catalogId=>{await waitForSave();const asset=await registerStockAudio({projectId,catalogId});setOptimisticAssets(previous=>[...previous.filter(item=>item._id!==asset._id),asset]);return asset;}} onShare={()=>setShareOpen(true)} onSaveThumbnail={persistThumbnail} projectId={projectId} draftKey={`revline:editor-draft:${projectId}`} title={title} onTitle={titleChange} timeline={activePreview?.timeline??timeline} liveEdit={activePreview??undefined} assets={assets} composerAttachments={[...composerMedia(assets,composerAssetIds),...(uploadToComposer?upload?.queue??[]:[]).map(item=>({id:`upload:${item.id}`,name:item.name,kind:item.kind,progress:upload?.phase==='uploading'?item.percent:undefined,error:item.error}))]} composerBusy={!!upload&&uploadToComposer} onRemoveComposerAttachment={id=>setComposerAssetIds(previous=>previous.filter(value=>value!==id))} onRemoveAsset={async asset=>{await waitForSave();await removeAsset({assetId:asset._id as Id<'assets'>});setComposerAssetIds(previous=>previous.filter(id=>id!==asset._id));store.setState(state=>({history:state.history.filter(edit=>!edit.clips.some(clip=>clip.assetId===asset._id)),future:state.future.filter(edit=>!edit.clips.some(clip=>clip.assetId===asset._id))}));setOptimisticAssets(previous=>previous.filter(item=>item._id!==asset._id));}} onRefreshMedia={handleRefreshMedia} onChange={change} saving={saving} saveFailed={saveFailed&&!saving} onRetrySave={()=>saves.retry()} upload={upload} error={error} onError={setError} onUndo={undo} onRedo={redo} canUndo={!!history.length} canRedo={!!future.length} assistantEditSnapshot={assistantEditSnapshot} canResumeEdit={!!project.aiRecovery?.requests.length} messages={EMPTY_MESSAGES} conversation={project.threadId?{projectId,threadId:project.threadId}:undefined} aiRunning={ai?.running??false} aiEditing={ai?.editing??false} aiWorkflowActive={ai?.workflowActive} aiConfigured={ai?.configured??false} modelSwitcher={ai?.modelSwitcher??false} allowedModels={ai?.allowedModels} defaultModelChoice={ai?.defaultModelChoice} aiError={ai?.error} onStop={async()=>{await stop({projectId});}} onSend={sendRequest} onExport={exportVideo} onDownloadExport={async jobId=>{window.location.assign(await downloadExport({jobId:jobId as Id<'renderJobs'>}));}} onCancelExport={jobId=>renderCancel({jobId:jobId as Id<'renderJobs'>}).then(()=>{})} exportState={exportState} onUpload={handleUpload} onDropUpload={files=>handleUpload(files,{addToTimeline:false})} onAttachUpload={files=>handleUpload(files,{addToTimeline:!timelineRef.current.clips.length,attach:true})} onImportVideo={async url=>{await waitForSave();const imported=await importVideo({projectId,url});setComposerImportIds(previous=>[...previous,imported.taskId]);}} videoImports={mediaTasks?.filter(task=>task.kind==='import')} analysisBusy={ai?.activity} analysisSource={ai?.activitySource} analysisProgress={ai?.activityProgress} analysisStartedAt={ai?.activityStartedAt} assistantBudgetUsed={ai?.budgetUsed} preparationActivity={!ai?.running?assets.find(asset=>asset.preparation?.status==='processing'&&timeline.clips.some(clip=>clip.assetId===asset._id))?.preparation?.message:undefined}/><ConnectedTimelineShareDialog projectId={projectId} open={shareOpen} onOpenChange={setShareOpen} title={title} timeline={timeline} assets={assets} onBeforePublish={waitForSave} publishDisabled={!!ai?.running || !timeline.clips.length}/></EditorStateProvider>;
}
