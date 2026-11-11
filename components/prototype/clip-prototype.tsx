'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { createEditorStore } from '@/lib/editor/store';
import { EMPTY_SCRIPTED_DEMO, scriptedDemoMedia } from '@/lib/editor/scripted-demo';
import { waitForDemoStep } from '@/lib/editor/scripted-demo-chat';
import { timelineDuration, type Timeline, type MediaAsset } from '@/lib/editor/types';
import { applyTwoRowLayout } from '@/lib/editor/two-row-layout';
import { TIMELINE_BASE_PX } from '@/lib/editor/timeline-zoom';
import { EditorStateProvider } from '@/components/editor/editor-state';
import { EditorShell } from '@/components/editor/editor-shell';
import { AssistantPanel } from '@/components/editor/assistant-panel';
import type { ChatMessage, ChatTool } from '@/components/editor/chat-types';
import type { PreviewHandle } from '@/components/editor/preview';
import { EditComposer } from '@/components/workspace/edit-composer';
import { ConversationStart } from '@/components/workspace/conversation-start';
import { WorkspaceNav } from '@/components/workspace/workspace-nav';
import picks from './clip-picks.json';
import '@/components/workspace/shared.css';
import '@/components/workspace/new-conversation.css';
import '@/components/editor/scripted-demo-editor.css';

type Pick = { title: string; start: number; end: number; facecam: number[] };
const highlights: Pick[] = picks.picks;
// The prototype's recordings live in the public revline-prototype R2 bucket; they are too large for static assets.
const MEDIA = 'https://pub-1cffb3ec2b3446ec91e49f18b328883c.r2.dev';
const source: MediaAsset = { _id: 'prototype-tenz', fileName: 'TenZ · VALORANT highlights.mp4', kind: 'video', previewOriginalPlayable: true, url: `${MEDIA}/tenz-source.mp4`, duration: picks.duration, width: picks.width, height: picks.height, thumbnailUrl: `${MEDIA}/source.jpg` };
const media = scriptedDemoMedia([source, ...highlights.map((pick, i): MediaAsset => {
  const [x, y, w, h] = pick.facecam;
  return { _id: `prototype-clip-${i}`, fileName: `${pick.title}.mp4`, kind: 'video', previewOriginalPlayable: true, url: `${MEDIA}/clip-${i + 1}.mp4`, duration: pick.end - pick.start, width: picks.width, height: picks.height, thumbnailUrl: `${MEDIA}/clip-${i + 1}.jpg`, analysis: { facecam: { version: 1, samples: [{ time: 0, kind: 'overlay', facecam: { x: x / picks.width, y: y / picks.height, w: w / picks.width, h: h / picks.height }, gameplay: { x: (x + w) / picks.width, y: 0, w: 1 - (x + w) / picks.width, h: 1 }, confidence: 1, reason: 'Panel measured on native frames for this saved recording segment.' }] } } };
})]);
const assets = media.assets;
const noUpload = async () => {};
function sourceSegment(start: number, duration: number, index: number): Timeline['clips'] {
  const video = `source-${index}`, audio = `${video}-audio`;
  return [{ id: video, kind: 'video', assetId: source._id, start, sourceStart: start, duration, track: 1, volume: 0, audioSeparated: true, linkedClipId: audio }, { id: audio, kind: 'audio', assetId: media.audioByVideo.get(source._id), start, sourceStart: start, duration, track: 1, volume: 1, linkedClipId: video }];
}
const sourceTimeline: Timeline = { ...EMPTY_SCRIPTED_DEMO, clips: sourceSegment(0, picks.duration, 0) };
const clipTimeline = (i: number): Timeline => {
  const assetId = `prototype-clip-${i}`, duration = highlights[i].end - highlights[i].start;
  const camera = `highlight-${i}-camera`, game = `highlight-${i}-game`, audio = `highlight-${i}-audio`;
  return applyTwoRowLayout({ ...EMPTY_SCRIPTED_DEMO, aspectRatio: 'vertical', clips: [
    { id: camera, kind: 'video', assetId, start: 0, sourceStart: 0, duration, track: 2, volume: 0, audioSeparated: true, linkedClipId: audio },
    { id: game, kind: 'video', assetId, start: 0, sourceStart: 0, duration, track: 1, volume: 0, audioSeparated: true },
    { id: audio, kind: 'audio', assetId: media.audioByVideo.get(assetId), start: 0, sourceStart: 0, duration, track: 1, volume: 1, linkedClipId: camera },
  ] }, assets, { topClipIds: [camera], bottomClipIds: [game], detectedRegions: true });
};

type ConversationStore = StoreApi<{ messages: ChatMessage[] }>;
const NO_MESSAGES: ChatMessage[] = [];
function PrototypeConversation({ chatStore, ...props }: Omit<ComponentProps<typeof AssistantPanel>, 'messages' | 'conversation'> & { chatStore: ConversationStore }) {
  const messages = useStore(chatStore, state => state.messages);
  return <AssistantPanel {...props} messages={messages}/>;
}

/** Scripted product demonstration. Nothing in this controller calls a backend. */
export function ClipPrototype() {
  const [store] = useState(() => createEditorStore(EMPTY_SCRIPTED_DEMO));
  const timeline = useStore(store, state => state.timeline);
  const [started, setStarted] = useState(false), [draft, setDraft] = useState('');
  const [conversation] = useState(() => createStore<{ messages: ChatMessage[] }>(() => ({ messages: [] })));
  const [running, setRunning] = useState(false);
  const setMessages = useCallback((next: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
    conversation.setState(state => ({ messages: typeof next === 'function' ? next(state.messages) : next }));
  }, [conversation]);
  const [count, setCount] = useState(0), [active, setActive] = useState('source');
  const [activity, setActivity] = useState<string | null>(null), [error, setError] = useState('');
  const [title, setTitle] = useState('TenZ · Best moments');
  const run = useRef<AbortController | null>(null), speed = useRef(1), preview = useRef<PreviewHandle | null>(null), playOnReady = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const sourceCuts = useRef(sourceTimeline);
  const ready = useCallback((handle: PreviewHandle) => { preview.current = handle; if (playOnReady.current) { handle.seek(0); handle.play(); } }, []);
  function show(next: Timeline, id: string) {
    playOnReady.current = id !== 'source';
    preview.current?.pause();
    store.getState().recover(next);
    store.setState({ playhead: 0, playing: false, zoom: Math.max(.003, ((root.current?.querySelector('.timeline-scroll')?.clientWidth ?? 800) - 30) / (TIMELINE_BASE_PX * Math.max(1, timelineDuration(next)))) });
    setActive(id);
  }
  const reset = useCallback(() => {
    run.current?.abort(); run.current = null; playOnReady.current = false;
    preview.current?.pause();
    store.getState().recover(EMPTY_SCRIPTED_DEMO); store.setState({ playhead: 0, playing: false });
    sourceCuts.current = sourceTimeline;
    setStarted(false); setRunning(false); setTitle('TenZ · Best moments'); setMessages([]); setCount(0); setActive('source'); setDraft(''); setActivity(null); setError('');
  }, [store, setMessages]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.altKey || !event.shiftKey || event.repeat) return;
      if (event.code === 'KeyR') { event.preventDefault(); reset(); }
      if (event.code === 'KeyF') { event.preventDefault(); speed.current = speed.current === 1 ? .2 : 1; }
    };
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('keydown', shortcut); run.current?.abort(); };
  }, [reset]);
  async function build(prompt: string) {
    if (run.current) return;
    if (!/^\/clip\s+\S[\s\S]*$/i.test(prompt.trim())) throw new Error('Start with /clip followed by a video link.');
    if (!highlights.length) throw new Error('The prepared highlights are not available yet.');
    const controller = new AbortController(), runId = crypto.randomUUID(); run.current = controller;
    setStarted(true); setRunning(true); setDraft(''); setCount(0); setError('');
    const blocks: NonNullable<ChatMessage['blocks']> = [];
    const publish = (done = false) => setMessages([{ id: `${runId}-request`, role: 'user', text: prompt }, { id: `${runId}-reply`, role: 'assistant', text: blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n'), blocks: [...blocks], steps: blocks.flatMap(b => b.type === 'tools' ? b.steps : []), status: done ? 'success' : 'streaming' }]);
    const wait = (ms: number) => waitForDemoStep(ms * speed.current, controller.signal);
    async function say(text: string) {
      blocks.push({ type: 'text', text: '' });
      const index = blocks.length - 1;
      for (const word of text.split(' ')) { controller.signal.throwIfAborted(); const block = blocks[index]; if (block.type === 'text') blocks[index] = { type: 'text', text: block.text + (block.text ? ' ' : '') + word }; publish(); await wait(45); }
    }
    async function tool(name: string, detail: string, ms: number, action?: () => void) {
      const step: ChatTool = { id: `${name}-${blocks.length}`, name, state: 'running', detail };
      blocks.push({ type: 'tools', steps: [step] }); setActivity(detail); publish();
      await wait(ms); action?.();
      blocks[blocks.length - 1] = { type: 'tools', steps: [{ ...step, state: 'done' }] }; publish();
    }
    try {
      show(EMPTY_SCRIPTED_DEMO, 'source'); publish();
      await wait(700); await say('I’ll find the strongest moments and turn them into vertical clips.');
      await tool('importVideoLink', 'Importing video', 4300, () => show(sourceTimeline, 'source'));
      await tool('analyzeMedia', 'Transcribing footage', 6500);
      await tool('inspectAssetAnalysis', 'Reading transcript and audio peaks', 2200);
      await tool('readFrames', 'Finding the best moments', 5800);
      await say(`Found ${highlights.length} strong moments. I’m cutting each one into its own 9:16 timeline.`);
      const boundaries = [...new Set([0, picks.duration, ...highlights.flatMap(pick => [pick.start, pick.end])])].sort((a, b) => a - b);
      const cut: Timeline = { ...sourceTimeline, markers: highlights.map((pick, i) => ({ id: `pick-${i}`, time: pick.start, label: pick.title })), clips: boundaries.slice(0, -1).flatMap((start, i) => sourceSegment(start, boundaries[i + 1] - start, i)) };
      await tool('split', 'Cutting highlight boundaries', 1800, () => { sourceCuts.current = cut; show(cut, 'source'); });
      for (let i = 0; i < highlights.length; i++) {
        await tool('createTimeline', `Creating ${highlights[i].title}`, 1800, () => { setCount(i + 1); show(clipTimeline(i), String(i)); });
        await tool('getFrames', 'Checking facecam and gameplay framing', 2300);
      }
      await say(`${highlights.length} clips ready. Each has its own vertical timeline — click a tab to play it.`); publish(true);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Reset and try again.');
      if (run.current === controller) setMessages(previous => previous.map(message => message.role === 'assistant' ? { ...message, status: 'aborted' } : message));
    } finally {
      if (run.current === controller) { run.current = null; setRunning(false); setActivity(null); }
    }
  }
  useEffect(() => {
    if (!started || running || active === 'source') return;
    const frame = requestAnimationFrame(() => { preview.current?.seek(0); preview.current?.play(); });
    return () => cancelAnimationFrame(frame);
  }, [active, running, started]);
  const tabs = [{ id: 'source', name: 'Source', aspectRatio: 'landscape' as const, duration: picks.duration, active: active === 'source' }, ...highlights.slice(0, count).map((pick, i) => ({ id: String(i), name: pick.title, aspectRatio: 'vertical' as const, duration: pick.end - pick.start, active: active === String(i) }))];
  return <div ref={root} className={started ? 'scripted-editor-demo' : 'workspace-page new-conversation new-conversation-empty'} data-building={running || undefined}>
    {started ? <EditorStateProvider store={store}><EditorShell demo title={title} onTitle={setTitle} timeline={timeline} assets={assets} onChange={next => store.getState().edit(next)} saving={false} upload={null} error={error} onError={setError} onUndo={() => store.getState().undo()} onRedo={() => store.getState().redo()} canUndo={false} canRedo={false} onUpload={noUpload} onDropUpload={noUpload} messages={NO_MESSAGES} aiRunning={running} aiConfigured onSend={build} onStop={async () => { run.current?.abort(); }} onExport={noUpload} exportState={null} onPreviewReady={ready} timelineTabs={tabs} timelineTabActions={{ onOpen: async id => { show(id === 'source' ? sourceCuts.current : clipTimeline(Number(id)), id); }, onCreate: noUpload, onRename: noUpload, onRemove: noUpload }} assistantPanel={<PrototypeConversation chatStore={conversation} running={running} configured demo={false} hasClips={!!timeline.clips.length} onSend={build} onStop={async () => { run.current?.abort(); }} activity={activity} error={error}/>}/></EditorStateProvider> : <><WorkspaceNav demo/><ConversationStart><div className="new-conversation-entry"><EditComposer slashCommands value={draft} onChange={setDraft} onSubmit={() => build(draft)} placeholder="Describe your video, or drop footage here"/></div></ConversationStart></>}
  </div>;
}
