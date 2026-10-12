'use client';
import { useState, useRef, useEffect } from 'react';
import { useStore } from 'zustand';
import { createEditorStore } from '@/lib/editor/store';
import { EditorStateProvider } from './editor-state';
import { EditorShell } from './editor-shell';
import { DEMO_ASSETS, DEMO_TIMELINE } from '@/lib/editor/demo';
import { MediaAsset, Timeline } from '@/lib/editor/types';
import { addMediaClip, focusForClip } from '@/lib/editor/operations';
import { trackFace } from '@/lib/editor/tracking';
import { inspectMedia } from '@/lib/editor/media';
export function DemoEditor({ embedded = false }: { embedded?: boolean } = {}) {
  const [store]=useState(()=>createEditorStore(DEMO_TIMELINE));const timeline=useStore(store,s=>s.timeline);const history=useStore(store,s=>s.history);const future=useStore(store,s=>s.future);const [assets,setAssets]=useState<MediaAsset[]>(DEMO_ASSETS);const [title,setTitle]=useState('Weekend in motion');const [error,setError]=useState('');
  const [analysisBusy,setAnalysisBusy]=useState<string|null>(null);const urls=useRef<string[]>([]);
  useEffect(()=>{
    let cancelled=false;
    const images=DEMO_ASSETS.filter(asset=>asset.kind==='image'&&asset.url).map(asset=>{
      const image=new Image();image.onload=()=>{if(cancelled||!image.naturalWidth||!image.naturalHeight)return;setAssets(current=>current.map(item=>item._id===asset._id?{...item,width:image.naturalWidth,height:image.naturalHeight}:item));};image.src=asset.url!;return image;
    });
    return()=>{cancelled=true;images.forEach(image=>{image.onload=null;});};
  },[]);
  useEffect(()=>()=>urls.current.forEach(u=>URL.revokeObjectURL(u)),[]);
  const change=(next:Timeline)=>{store.getState().edit(next);setError('');};
  return <EditorStateProvider store={store}><EditorShell embedded={embedded} title={title} onTitle={setTitle} timeline={timeline} assets={assets} onChange={change} saving={false} upload={null} error={error} onError={setError} demo
    onUndo={()=>{store.getState().undo();}} onRedo={()=>{store.getState().redo();}} canUndo={!!history.length} canRedo={!!future.length}
    onUpload={async files=>{let next=timeline;const imported:MediaAsset[]=[];for(const file of files){try{const meta=await inspectMedia(file);const url=URL.createObjectURL(file);urls.current.push(url);const asset={_id:crypto.randomUUID(),fileName:file.name,url,...meta};imported.push(asset);next=addMediaClip(next,asset,crypto.randomUUID());}catch(e){setError((e as Error).message);}}if(imported.length){setAssets(a=>[...a,...imported]);change(next);}}}
    messages={[{id:'sample-user',role:'user',text:'Make a weekend film from these clips. Keep it\npunchy, with a good opening and clean captions.'},{id:'sample-assistant',role:'assistant',text:'I found your opening, tightened the pacing, and gave the captions\nroom to breathe. Here’s your first cut.',tools:['9 shots arranged in a short sequence','Opening title and end card placed','5 editable captions on their own track']}]} aiRunning={false} aiConfigured={false} analysisBusy={analysisBusy} onAnalyze={async(mode,assetId)=>{if(mode!=='track')return;const asset=assets.find(a=>a._id===assetId);if(!asset)return;setAnalysisBusy('Following face…');try{const focus=await trackFace(asset,n=>setAnalysisBusy(`Following face · ${n}%`));setAssets(a=>a.map(item=>item._id===assetId?{...item,analysis:{...item.analysis,focus}}:item));change({...timeline,clips:timeline.clips.map(c=>c.assetId===assetId&&c.kind==='video'?{...c,focus:focusForClip(focus,c)}:c)});}catch(e){setError((e as Error).message);}finally{setAnalysisBusy(null);}}} onSend={async text=>{sessionStorage.setItem('revline:next-brief',text);window.location.assign('/dashboard/chat');}} onExport={async()=>{}} exportState={null}/></EditorStateProvider>
}
