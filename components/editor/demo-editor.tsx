'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';
import { useState, useRef, useEffect } from 'react';
import { useStore } from 'zustand';
import { createEditorStore } from '@/lib/editor/store';
import { EditorStateProvider } from './editor-state';
import { EditorShell } from './editor-shell';
import { DEMO_ASSETS, DEMO_TIMELINE } from '@/lib/editor/demo';
import { MediaAsset, Timeline } from '@/lib/editor/types';
import { addMediaClip } from '@/lib/editor/operations';
import { stockAudioAsset } from '@/lib/editor/stock-audio';
import { inspectMedia } from '@/lib/editor/media';
export function DemoEditor({ embedded = false }: { embedded?: boolean } = {}) {
  const [store]=useState(()=>{const instance=createEditorStore(DEMO_TIMELINE);if(embedded)instance.setState({playhead:4.2,compactTracks:true,zoom:.75});return instance;});const timeline=useStore(store,s=>s.timeline);const history=useStore(store,s=>s.history);const future=useStore(store,s=>s.future);const [assets,setAssets]=useState<MediaAsset[]>(DEMO_ASSETS);const [title,setTitle]=useState('Weekend in motion');const [error,setError]=useState('');
  const urls=useRef<string[]>([]);
  useEffect(()=>{
    let cancelled=false;
    const images=DEMO_ASSETS.filter(asset=>asset.kind==='image'&&asset.url).map(asset=>{
      const image=new Image();image.onload=()=>{if(cancelled||!image.naturalWidth||!image.naturalHeight)return;setAssets(current=>current.map(item=>item._id===asset._id?{...item,width:image.naturalWidth,height:image.naturalHeight}:item));};image.src=asset.url!;return image;
    });
    return()=>{cancelled=true;images.forEach(image=>{image.onload=null;});};
  },[]);
  useEffect(()=>()=>urls.current.forEach(u=>URL.revokeObjectURL(u)),[]);
  const change=(next:Timeline)=>{store.getState().edit(next);setError('');};
  async function uploadFiles(files:File[],addToTimeline:boolean){let next=timeline;const imported:MediaAsset[]=[];for(const file of files){try{const meta=await inspectMedia(file);const url=URL.createObjectURL(file);urls.current.push(url);const asset={_id:crypto.randomUUID(),fileName:file.name,url,...meta};imported.push(asset);if(addToTimeline)next=addMediaClip(next,asset,crypto.randomUUID());}catch(e){setError((e as Error).message);}}if(imported.length){setAssets(a=>[...a,...imported]);if(addToTimeline)change(next);}}
  return <EditorStateProvider store={store}><EditorShell onRegisterStockAudio={async catalogId=>{const asset=stockAudioAsset(catalogId);setAssets(previous=>previous.some(item=>item._id===asset._id)?previous:[...previous,asset]);return asset;}} embedded={embedded} title={title} onTitle={setTitle} timeline={timeline} assets={assets} onChange={change} saving={false} upload={null} error={error} onError={setError} demo
    onUndo={()=>{store.getState().undo();}} onRedo={()=>{store.getState().redo();}} canUndo={!!history.length} canRedo={!!future.length}
    onUpload={files=>uploadFiles(files,true)} onDropUpload={files=>uploadFiles(files,false)}
    messages={[{id:'sample-user',role:'user',text:'Make a weekend film from these clips. Keep it\npunchy, with a good opening and clean captions.'},{id:'sample-assistant',role:'assistant',text:'I found your opening, tightened the pacing, and gave the captions\nroom to breathe. Here’s your first cut.',tools:['9 shots arranged in a short sequence','Opening title and end card placed','5 editable captions on their own track']}]} aiRunning={false} aiConfigured={false} onSend={async text=>{sessionStorage.setItem('revline:next-brief',text);window.location.assign(NEW_PROJECT_PATH);}} onExport={async()=>{}} exportState={null}/></EditorStateProvider>
}
