'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { RotateCcw, Play } from 'lucide-react';
import { createEditorStore } from '@/lib/editor/store';
import { inspectMedia } from '@/lib/editor/media';
import { normalizeMediaFile } from '@/lib/editor/media-file';
import { EMPTY_SCRIPTED_DEMO, scriptedDemoPlan, scriptedDemoMedia } from '@/lib/editor/scripted-demo';
import { HORMOZI_DEMO_ASSET, hormoziDemoPlan } from '@/lib/editor/hormozi-demo';
import type { MediaAsset, Timeline } from '@/lib/editor/types';
import type { ComposerAttachment } from '@/components/workspace/edit-composer';
import { stockAudioAsset } from '@/lib/editor/stock-audio';
import { userError } from '@/lib/user-error';
import { AssistantPanel, type ChatMessage } from './assistant-panel';
import { EditorStateProvider } from './editor-state';
import { EditorShell } from './editor-shell';
import './scripted-demo-editor.css';

function waitForStep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** Separate, local-only recording route. The production editor never uses this script. */
export function ScriptedDemoEditor({ demoId }: { demoId: string }) {
  const preparedTake=demoId==='hormozi-take-1';
  const [store] = useState(() => createEditorStore(EMPTY_SCRIPTED_DEMO));
  const timeline = useStore(store, state => state.timeline), history = useStore(store, state => state.history), future = useStore(store, state => state.future);
  const [assets, setAssets] = useState<MediaAsset[]>([]), [pending, setPending] = useState<ComposerAttachment[]>([]);
  const [stockAssets, setStockAssets] = useState<MediaAsset[]>([]);
  const [submittedAssetIds, setSubmittedAssetIds] = useState<string[]>([]);
  const media = useMemo(() => scriptedDemoMedia([...(preparedTake?[HORMOZI_DEMO_ASSET]:assets),...stockAssets]), [assets,preparedTake,stockAssets]);
  const [messages, setMessages] = useState<ChatMessage[]>([]), [running, setRunning] = useState(false), [importing, setImporting] = useState(false);
  const [error, setError] = useState(''), [title, setTitle] = useState('Your next edit'), [activity, setActivity] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const input = useRef<HTMLInputElement>(null), assetsRef = useRef<MediaAsset[]>([]), urls = useRef<string[]>([]), activeRun = useRef<AbortController | null>(null);
  const mounted = useRef(true), importingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRun.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; };
  }, []);

  function reset() {
    activeRun.current?.abort(); activeRun.current = null;
    store.getState().recover(EMPTY_SCRIPTED_DEMO); store.setState({ playhead: 0, playing: false });
    setRunning(false); setActivity(null); setMessages([]); setError(''); setSubmittedAssetIds([]);
  }
  async function attach(files: File[]) {
    if (activeRun.current || importingRef.current) throw new Error('Finish or stop the edit before adding more footage.');
    if (assetsRef.current.length + files.length > 8) throw new Error('Use up to eight local files for this edit.');
    importingRef.current = true; setImporting(true); setError('');
    try {
      for (const incoming of files) {
        if (!mounted.current) return;
        const file = normalizeMediaFile(incoming);
        if (!file) { setPending(current => [...current, { id: crypto.randomUUID(), name: incoming.name, error: 'Use a non-empty video, image, or audio file.' }]); continue; }
        const id = crypto.randomUUID(), url = URL.createObjectURL(file); urls.current.push(url);
        const kind:MediaAsset['kind'] = file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : 'video';
        setPending(current => [...current, { id, name: file.name, url, kind, progress: 25 }]);
        try {
          let thumbnailUrl: string | undefined;
          const metadata = preparedTake?{kind}:await inspectMedia(file, blob => { if (mounted.current) { thumbnailUrl = URL.createObjectURL(blob); urls.current.push(thumbnailUrl); } });
          if (!mounted.current) return;
          const asset: MediaAsset = { _id: id, fileName: file.name, url, thumbnailUrl, ...metadata };
          assetsRef.current = [...assetsRef.current, asset]; setAssets(assetsRef.current);
          setPending(current => current.filter(item => item.id !== id));
        } catch (error) { if (mounted.current) {
          const message = userError(error, 'Could not read this local file.');
          setPending(current => current.map(item => item.id === id ? { id, name: file.name, kind, error: message } : item));
          setError(message);
        } }
      }
    } finally { importingRef.current = false; if (mounted.current) setImporting(false); }
  }
  function removeAttachment(id: string) {
    if (activeRun.current || importingRef.current) return;
    reset(); assetsRef.current = assetsRef.current.filter(asset => asset._id !== id); setAssets(assetsRef.current); setPending(current => current.filter(item => item.id !== id));
  }
  async function build(prompt: string) {
    if (activeRun.current || importingRef.current) return;
    if(preparedTake&&!assetsRef.current.length)throw new Error('Attach media before starting the edit.');
    const runId = `demo-build-${crypto.randomUUID()}`, plan = preparedTake?hormoziDemoPlan(runId):scriptedDemoPlan(assetsRef.current, prompt, runId);
    const controller = new AbortController(); activeRun.current = controller;
    setSubmittedAssetIds(assetsRef.current.map(asset => asset._id));
    setError(''); setLastPrompt(prompt); setRunning(true); setActivity('Building your edit…');
    setMessages([{ id: `${runId}-request`, role: 'user', text: prompt }, { id: `${runId}-reply`, role: 'assistant', status: 'streaming', text: preparedTake?plan.steps[0].reply:'I’ll build a short sequence with cuts, captions, and subtle effects.' }]);
    store.getState().recover(plan.initial); store.setState({ playhead: 0, playing: false }); store.getState().beginUndoGroup(runId);
    let current = plan.initial;
    try {
      await waitForStep(800, controller.signal);
      for (const step of plan.steps) {
        current = { ...current, clips: [...current.clips, ...step.clips] };
        store.getState().edit(current); setActivity(step.label);
        setMessages(previous => previous.map(message => message.id === `${runId}-reply` ? { ...message, text: step.reply } : message));
        await waitForStep(step.delayMs, controller.signal);
      }
      setMessages(previous => previous.map(message => message.id === `${runId}-reply` ? { ...message, status: 'success', text: plan.summary } : message));
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setError(userError(error, 'The edit stopped. Reset and try again.'));
      if (mounted.current && activeRun.current === controller) setMessages(previous => previous.map(message => message.id === `${runId}-reply` ? { ...message, status: 'aborted', text: 'Stopped. The blocks already placed remain editable.' } : message));
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null; store.getState().endUndoGroup();
        if (mounted.current) { setRunning(false); setActivity(null); }
      }
    }
  }
  const attachments: ComposerAttachment[] = [...assets.filter(asset => !submittedAssetIds.includes(asset._id)).map(asset => ({ id: asset._id, name: asset.fileName, url: asset.thumbnailUrl ?? asset.url ?? undefined, kind: asset.thumbnailUrl ? 'image' as const : asset.kind })), ...pending];
  const chat = <div className="scripted-demo-conversation">
    <div className="scripted-demo-controls" aria-label="Sequence controls">
      <button type="button" title="Replay edit" aria-label="Replay edit" disabled={running || importing || !lastPrompt || !assets.length} onClick={() => void build(lastPrompt).catch(error => setError(userError(error)))}><Play size={13}/></button>
      <button type="button" title="Reset the timeline, keep attached footage" aria-label="Reset edit" disabled={importing} onClick={reset}><RotateCcw size={13}/></button>
    </div>
    <AssistantPanel messages={messages} running={running} configured demo={false} hasClips={!!assets.length} onSend={build} onStop={async () => { activeRun.current?.abort(); }} onAttach={() => input.current?.click()} attachments={attachments} onRemoveAttachment={removeAttachment} requireMedia={!assets.length || attachments.length > 0 || importing} activity={importing ? 'Reading local footage…' : activity}/>
  </div>;
  function change(next: Timeline) { if (!activeRun.current) { store.getState().edit(next); setError(''); } }
  return <div className="scripted-editor-demo" data-demo-id={demoId} data-building={running || undefined}>
    <input ref={input} data-demo-files type="file" hidden multiple accept="video/*,image/*,audio/*" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void attach(files).catch(error => setError(userError(error))); }}/>
    <EditorStateProvider store={store}><EditorShell onRegisterStockAudio={async catalogId=>{if(activeRun.current)throw new Error('Finish or stop the edit before adding a sound.');const asset=stockAudioAsset(catalogId);setStockAssets(previous=>previous.some(item=>item._id===asset._id)?previous:[...previous,asset]);return asset;}} title={title} onTitle={setTitle} timeline={timeline} assets={media.assets} onChange={change} saving={false} upload={null} error={error} onError={setError} demo assistantPanel={chat}
      onUndo={() => { if (!activeRun.current) store.getState().undo(); }} onRedo={() => { if (!activeRun.current) store.getState().redo(); }} canUndo={!running && !!history.length} canRedo={!running && !!future.length}
      onUpload={attach} onDropUpload={attach} messages={messages} aiRunning={running} aiConfigured={false} onSend={build} onStop={async () => { activeRun.current?.abort(); }} onExport={async () => {}} exportState={null}/></EditorStateProvider>
  </div>;
}
