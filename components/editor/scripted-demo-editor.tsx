'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { RotateCcw, Play } from 'lucide-react';
import { createEditorStore } from '@/lib/editor/store';
import { inspectMedia } from '@/lib/editor/media';
import { normalizeMediaFile } from '@/lib/editor/media-file';
import { EMPTY_SCRIPTED_DEMO, scriptedDemoPlan, scriptedDemoMedia } from '@/lib/editor/scripted-demo';
import { streamDemoText, waitForDemoStep } from '@/lib/editor/scripted-demo-chat';
import { HORMOZI_DEMO_ASSET, hormoziDemoPlan } from '@/lib/editor/hormozi-demo';
import { RACING_DEMO_ASSETS, racingDemoPlan } from '@/lib/editor/racing-demo';
import { F1_RECORDING_ASSETS, f1RecordingDemoPlan } from '@/lib/editor/f1-recording-demo';
import { REVLINE_RECORDING_ASSETS, revlineRecordingDemoPlan } from '@/lib/editor/revline-recording-demo';
import type { MediaAsset, Timeline } from '@/lib/editor/types';
import type { ComposerAttachment } from '@/components/workspace/edit-composer';
import { stockAudioAsset } from '@/lib/editor/stock-audio';
import { userError } from '@/lib/user-error';
import { TIMELINE_BASE_PX } from '@/lib/editor/timeline-zoom';
import { animateDemoCutPreview } from './demo-cut-preview';
import { AssistantPanel, type ChatMessage } from './assistant-panel';
import { EditorStateProvider } from './editor-state';
import { EditorShell } from './editor-shell';
import type { PreviewHandle } from './preview';
import './scripted-demo-editor.css';

type DemoConversationStore = StoreApi<{ messages: ChatMessage[] }>;
const NO_MESSAGES: ChatMessage[] = [];

/** Word updates belong to the chat leaf, independently of the preview and timeline. */
function DemoConversation({ chatStore, ...props }: Omit<ComponentProps<typeof AssistantPanel>, 'messages' | 'conversation'> & { chatStore: DemoConversationStore }) {
  const messages = useStore(chatStore, state => state.messages);
  return <AssistantPanel {...props} messages={messages}/>;
}

/** Separate, local-only recording route. The production editor never uses this script. */
export function ScriptedDemoEditor({ demoId }: { demoId: string }) {
  const revlineTake=demoId==='revline-take-1';
  const racingTake=demoId==='racing-take-1';
  const f1Take=demoId==='hormozi-take-1'||demoId==='f1-take-1';
  const preparedTake=revlineTake||racingTake||f1Take||demoId==='interview-take-1';
  const [store] = useState(() => createEditorStore(revlineTake?revlineRecordingDemoPlan('opening').initial:EMPTY_SCRIPTED_DEMO));
  const timeline = useStore(store, state => state.timeline), history = useStore(store, state => state.history), future = useStore(store, state => state.future);
  const [assets, setAssets] = useState<MediaAsset[]>(()=>revlineTake?REVLINE_RECORDING_ASSETS:[]), [pending, setPending] = useState<ComposerAttachment[]>([]);
  const [stockAssets, setStockAssets] = useState<MediaAsset[]>([]);
  const [submittedAssetIds, setSubmittedAssetIds] = useState<string[]>([]);
  const media = useMemo(() => revlineTake ? { assets: [...REVLINE_RECORDING_ASSETS, ...stockAssets] } : f1Take ? { assets: [...F1_RECORDING_ASSETS, ...stockAssets] } : racingTake ? { assets: [...RACING_DEMO_ASSETS, ...stockAssets] } : scriptedDemoMedia([...(preparedTake?[HORMOZI_DEMO_ASSET]:assets),...stockAssets]), [assets,preparedTake,racingTake,f1Take,revlineTake,stockAssets]);
  const [conversation] = useState(() => createStore<{ messages: ChatMessage[] }>(() => ({ messages: [] })));
  const [running, setRunning] = useState(false), [importing, setImporting] = useState(false);
  const [error, setError] = useState(''), [title, setTitle] = useState('Your next edit'), [activity, setActivity] = useState<string | null>(null);
  const [activityStartedAt, setActivityStartedAt] = useState<number | null>(null);
  const [lastPrompt, setLastPrompt] = useState('');
  const [demoPhase, setDemoPhase] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null), preview = useRef<PreviewHandle | null>(null), assetsRef = useRef<MediaAsset[]>(revlineTake?REVLINE_RECORDING_ASSETS:[]), urls = useRef<string[]>([]), activeRun = useRef<AbortController | null>(null);
  const onPreviewReady = useCallback((controller: PreviewHandle) => { preview.current = controller; }, []);
  const mounted = useRef(true), importingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRun.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; };
  }, []);

  function setMessages(next: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) {
    conversation.setState(state => ({ messages: typeof next === 'function' ? next(state.messages) : next }));
  }
  function reset() {
    activeRun.current?.abort(); activeRun.current = null;
    store.getState().recover(EMPTY_SCRIPTED_DEMO); store.setState({ playhead: 0, playing: false });
    setRunning(false); setDemoPhase(undefined); setActivity(null); setActivityStartedAt(null); setMessages([]); setError(''); setSubmittedAssetIds([]);
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
    const runId = `demo-build-${crypto.randomUUID()}`, f1Plan = revlineTake ? revlineRecordingDemoPlan(runId) : f1Take ? f1RecordingDemoPlan(runId) : null, plan = f1Plan ?? (racingTake?racingDemoPlan(runId):preparedTake?hormoziDemoPlan(runId):scriptedDemoPlan(assetsRef.current, prompt, runId));
    const controller = new AbortController(); activeRun.current = controller;
    setSubmittedAssetIds(assetsRef.current.map(asset => asset._id));
    setError(''); setLastPrompt(prompt); setRunning(true); setActivity('Queued for analysis…'); setActivityStartedAt(Date.now());
    setMessages([{ id: `${runId}-request`, role: 'user', text: prompt }, { id: `${runId}-reply`, role: 'assistant', status: 'streaming', text: '' }]);
    store.getState().recover(plan.initial); store.setState({ playhead: 0, playing: false }); store.getState().beginUndoGroup(runId);
    if (f1Plan) {
      const width = root.current?.querySelector<HTMLElement>('.timeline-scroll')?.clientWidth ?? 720;
      store.setState({ zoom: Math.min(1, Math.max(.03, (width - 24) / (TIMELINE_BASE_PX * (Math.max(...plan.initial.clips.map(clip=>clip.start+clip.duration))+1)))) });
      setDemoPhase('queued');
    }
    let current = plan.initial;
    const opening = preparedTake ? plan.steps[0].reply : 'I’ll build a short sequence with cuts, captions, and subtle effects.';
    const details = plan.steps.find(step => step.clips.some(clip => clip.kind === 'caption' || clip.kind === 'graphic'))?.reply;
    const stagedNarration = plan.steps.some(step => step.narrate);
    async function narrate(text: string, separator = '') {
      let prefix = separator;
      await streamDemoText(text, controller.signal, chunk => {
        const addition = prefix + chunk; prefix = '';
        if (mounted.current && activeRun.current === controller) setMessages(previous => previous.map(message => message.id === `${runId}-reply` ? { ...message, text: message.text + addition } : message));
      });
    }
    try {
      await waitForDemoStep(450, controller.signal);
      if (media.assets.some(asset => asset.kind === 'video' || asset.kind === 'image')) {
        setActivity('Watching footage…'); setActivityStartedAt(Date.now());
        if (f1Plan) setDemoPhase('watching');
        await waitForDemoStep(1750, controller.signal);
      }
      if (media.assets.some(asset => asset.kind === 'audio' || asset.audioAssetId || asset.waveform)) {
        setActivity('Listening to your footage…'); setActivityStartedAt(Date.now());
        if (f1Plan) setDemoPhase('listening');
        await waitForDemoStep(1450, controller.signal);
      }
      setActivity('Applying edits…'); setActivityStartedAt(Date.now());
      if (f1Plan && root.current) {
        setActivity('Trimming…');
        await animateDemoCutPreview(root.current, f1Plan.cutPreview, controller.signal, () => {
          current = f1Plan.cutPreview.timeline;
          store.getState().edit(current);
        }, phase => setDemoPhase(phase === 'planned' ? 'trimming' : phase === 'closing' ? 'closing-gap' : 'arranging'));
      }
      const buildTimeline = (async () => {
        await waitForDemoStep(800, controller.signal);
        let narrated = false;
        for (const step of plan.steps) {
          controller.signal.throwIfAborted();
          if (step.clips.length) {
            current = { ...current, clips: [...current.clips, ...step.clips] };
            store.getState().edit(current);
          }
          setActivity(step.label);
          if (f1Plan) setDemoPhase(step.clips.some(clip => clip.kind === 'graphic') ? 'adding-text' : step.clips.some(clip => clip.kind === 'effect') ? 'adding-effects' : 'arranging');
          if (step.previewTime !== undefined) {
            // This recording route previews its authored title/FX pose. Updating
            // the shared clock alone does not seek the native player.
            preview.current?.seek(step.previewTime);
            store.setState({ playhead: step.previewTime });
          }
          if (step.narrate) {
            await Promise.all([waitForDemoStep(step.delayMs, controller.signal), narrate(step.reply, narrated ? '\n\n' : '')]);
            narrated = true;
          } else await waitForDemoStep(step.delayMs, controller.signal);
        }
      })();
      if (stagedNarration) {
        await buildTimeline;
        await waitForDemoStep(350, controller.signal);
        await narrate(plan.summary, '\n\n');
      } else await Promise.all([buildTimeline, (async () => {
        await narrate(opening);
        if (details && details !== opening) { await waitForDemoStep(320, controller.signal); await narrate(details, '\n\n'); }
        await buildTimeline;
        await waitForDemoStep(350, controller.signal);
        await narrate(plan.summary, '\n\n');
      })()]);
      if (f1Plan) { setDemoPhase('saving'); setActivity('Saving your edit…'); await waitForDemoStep(650, controller.signal); }
      setMessages(previous => previous.map(message => message.id === `${runId}-reply` ? { ...message, status: 'success' } : message));
      if (f1Plan) setDemoPhase('ready');
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setError(userError(error, 'The edit stopped. Reset and try again.'));
      controller.abort();
      if (f1Plan && mounted.current && activeRun.current === controller) setDemoPhase('stopped');
      if (mounted.current && activeRun.current === controller) setMessages(previous => previous.map(message => message.id === `${runId}-reply` ? { ...message, status: 'aborted', text: `${message.text.trimEnd()}${message.text.trim() ? '\n\n' : ''}Stopped. The blocks already placed remain editable.` } : message));
    } finally {
      if (activeRun.current === controller) {
        activeRun.current = null; store.getState().endUndoGroup();
        if (mounted.current) { setRunning(false); setActivity(null); setActivityStartedAt(null); }
      }
    }
  }
  const attachments: ComposerAttachment[] = [...assets.filter(asset => !submittedAssetIds.includes(asset._id)).map(asset => ({ id: asset._id, name: asset.fileName, url: asset.thumbnailUrl ?? asset.url ?? undefined, kind: asset.thumbnailUrl ? 'image' as const : asset.kind })), ...pending];
  const chat = <div className="scripted-demo-conversation">
    <div className="scripted-demo-controls" aria-label="Sequence controls">
      {racingTake ? <a href="/demo/racing/credits.html" target="_blank" rel="noreferrer" style={{ marginRight: 'auto', color: 'inherit' }}>Footage &amp; license ↗</a> : null}
      <button type="button" title="Replay edit" aria-label="Replay edit" disabled={running || importing || !lastPrompt || !assets.length} onClick={() => void build(lastPrompt).catch(error => setError(userError(error)))}><Play size={13}/></button>
      <button type="button" title="Reset the timeline, keep attached footage" aria-label="Reset edit" disabled={importing} onClick={reset}><RotateCcw size={13}/></button>
    </div>
    <DemoConversation chatStore={conversation} running={running} configured demo={false} hasClips={!!assets.length} onSend={build} onStop={async () => { activeRun.current?.abort(); }} onAttach={() => input.current?.click()} attachments={attachments} onRemoveAttachment={removeAttachment} requireMedia={!assets.length || attachments.length > 0 || importing} activity={importing ? 'Reading local footage…' : activity} activityStartedAt={activityStartedAt} activitySource={(media.assets.find(asset => asset.kind === 'video') ?? media.assets.find(asset => asset.kind === 'audio'))?.fileName} error={error}/>
  </div>;
  function change(next: Timeline) { if (!activeRun.current) { store.getState().edit(next); setError(''); } }
  return <div ref={root} className="scripted-editor-demo" data-demo-id={demoId} data-demo-edit-phase={f1Take ? demoPhase : undefined} data-building={running || undefined}>
    <input ref={input} data-demo-files type="file" hidden multiple accept="video/*,image/*,audio/*" onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void attach(files).catch(error => setError(userError(error))); }}/>
    <EditorStateProvider store={store}><EditorShell onPreviewReady={onPreviewReady} onRegisterStockAudio={async catalogId=>{if(activeRun.current)throw new Error('Finish or stop the edit before adding a sound.');const asset=stockAudioAsset(catalogId);setStockAssets(previous=>previous.some(item=>item._id===asset._id)?previous:[...previous,asset]);return asset;}} title={title} onTitle={setTitle} timeline={timeline} assets={media.assets} onChange={change} saving={false} upload={null} error={error} onError={setError} demo assistantPanel={chat}
      onUndo={() => { if (!activeRun.current) store.getState().undo(); }} onRedo={() => { if (!activeRun.current) store.getState().redo(); }} canUndo={!running && !!history.length} canRedo={!running && !!future.length}
      onUpload={attach} onDropUpload={attach} messages={NO_MESSAGES} aiRunning={running} aiConfigured={false} onSend={build} onStop={async () => { activeRun.current?.abort(); }} onExport={async () => {}} exportState={null}/></EditorStateProvider>
  </div>;
}
