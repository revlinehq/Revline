'use client';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createEditorStore } from '@/lib/editor/store';
import { TIMELINE_BASE_PX } from '@/lib/editor/timeline-zoom';
import { normalizeTimeline, type Clip, type MediaAsset, type Timeline } from '@/lib/editor/types';
import { AssistantPanel, type ChatMessage } from '@/components/editor/assistant-panel';
import { EditorStateProvider } from '@/components/editor/editor-state';
import { EditorShell } from '@/components/editor/editor-shell';
import { ChatGPTChat, ClaudeChat } from './agent-chats';
import type { PreviewHandle } from '@/components/editor/preview';
import waveform from '@/public/landing/blueprint-launch-v2.waveform.json';
import '@/app/editor.css';

export const FILM_SECONDS = 37.92;

// Beat starts in film seconds, from the Blueprint launch markers. They label the timeline's markers.
export const BEATS: { at: number; label: string }[] = [
  { at: 0, label: 'Intro title' }, { at: 2.9, label: 'Composer' }, { at: 6.8, label: 'Chat' }, { at: 8.9, label: 'Screenshot parts' },
  { at: 12.5, label: 'Timeline edit' }, { at: 16.4, label: 'Reveal' }, { at: 18.5, label: 'Meet T3 Code' }, { at: 19, label: 'First ADE' },
  { at: 21.37, label: 'Composer' }, { at: 23.87, label: 'Chat' }, { at: 26.67, label: 'Threads' }, { at: 29.77, label: 'Code view' },
  { at: 31.3, label: 'Browser' }, { at: 32.87, label: 'Free / Open source' }, { at: 35.6, label: 'Made for everyone' },
];
// The half-second "Meet T3 Code" title shares a clip with "First ADE", so the timeline holds the 14 clips the chat mentions.
const CUTS = BEATS.filter(beat => beat.label !== 'First ADE').map(beat => beat.at);

const FILM_ID = 'blueprint-launch', AUDIO_ID = 'blueprint-launch-audio';
const noop = () => {}, nothing = async () => {};

function filmTimeline(): Timeline {
  const video: Clip[] = CUTS.map((at, index) => {
    const end = CUTS[index + 1] ?? FILM_SECONDS;
    return { id: `beat-${index}`, kind: 'video', assetId: FILM_ID, track: 1, start: at, duration: end - at, sourceStart: at, volume: 0, audioSeparated: true };
  });
  const audio: Clip = { id: 'soundtrack', kind: 'audio', assetId: AUDIO_ID, track: 1, start: 0, duration: FILM_SECONDS, sourceStart: 0, volume: 1 };
  return normalizeTimeline({ fps: 60, aspectRatio: 'landscape', tracks: { visual: 1, overlay: 0, audio: 1, effects: 0 }, clips: [...video, audio],
    markers: BEATS.map((beat, index) => ({ id: `marker-${index}`, time: beat.at, label: beat.label })) });
}

function filmAssets(url: string, poster: string): MediaAsset[] {
  return [
    { _id: FILM_ID, kind: 'video', fileName: 'Blueprint launch.mp4', url, thumbnailUrl: poster, duration: FILM_SECONDS, width: 1920, height: 1080, audioAssetId: AUDIO_ID, audioExtracted: true, waveform },
    { _id: AUDIO_ID, kind: 'audio', fileName: 'Blueprint launch · original sound', url, duration: FILM_SECONDS, waveform },
    // The two screenshots the film was made from, as they sit in the project's media.
    { _id: 't3-new-thread', kind: 'image', fileName: 'T3 Code new thread.png', url: '/landing/editor/t3-new-thread.webp', thumbnailUrl: '/landing/editor/t3-new-thread.webp', width: 1919, height: 1039 },
    { _id: 't3-working', kind: 'image', fileName: 'T3 Code working.png', url: '/landing/editor/t3-working.webp', thumbnailUrl: '/landing/editor/t3-working.webp', width: 1918, height: 1043 },
  ];
}

// The conversation that made the film, in the editor's own message format.
const MESSAGES: ChatMessage[] = [
  { id: 'request', role: 'user', text: 'Make these a launch film' },
  { id: 'read', role: 'assistant', status: 'success', text: '', tools: ['Read 2 screenshots'] },
  { id: 'parts', role: 'assistant', status: 'success', text: 'Breaking each screen into parts. 🫡', tools: ['Built 14 clips', 'Matched colors and type', 'Timed cuts to the music'] },
  { id: 'done', role: 'assistant', status: 'success', text: 'Your launch film is on the timeline.' },
];

// The workspace is always dark, keyed on <html data-workspace-theme=dark>, while the landing page stays light.
// Copy those dark rules once, scoped to the hero's wrapper, so only the editor turns dark.
const DARK_SCOPE = 'landing-editor-dark', DARK_ROOT = /html\[data-workspace-theme="?dark"?\]/g;
function scopeWorkspaceDarkTheme() {
  if (document.getElementById(DARK_SCOPE)) return;
  const copied: string[] = [];
  const visit = (rules: CSSRuleList, wrap: (css: string) => string) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && DARK_ROOT.test(rule.selectorText)) copied.push(wrap(rule.cssText.replace(DARK_ROOT, `.${DARK_SCOPE}`)));
      else if (rule instanceof CSSMediaRule) visit(rule.cssRules, css => wrap(`@media ${rule.conditionText}{${css}}`));
      DARK_ROOT.lastIndex = 0;
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try { visit(sheet.cssRules, css => css); } catch { /* Cross-origin sheets (fonts) have no workspace rules. */ }
  }
  if (!copied.length) return;
  const style = document.createElement('style');
  style.id = DARK_SCOPE;
  style.textContent = copied.join('\n');
  document.head.appendChild(style);
}

/** Revline's real editor, with the launch film on its timeline: local state only, no account or backend. */
export type HeroChat = 'revline' | 'claude' | 'chatgpt';

export default function LandingHeroEditor({ url, poster, chat, onPreviewReady }: { url: string; poster: string; chat: HeroChat; onPreviewReady: (preview: PreviewHandle) => void }) {
  // Muted, so the film may start on its own when the hero comes into view.
  const [store] = useState(() => { const store = createEditorStore(filmTimeline()); store.setState({ muted: true }); return store; });
  const [assets] = useState(() => filmAssets(url, poster));
  const [title, setTitle] = useState('Blueprint launch');
  const [error, setError] = useState('');
  useEffect(scopeWorkspaceDarkTheme, []);
  return <div className={`dark ${DARK_SCOPE}`}><EditorStateProvider store={store}><Shell store={store} assets={assets} title={title} onTitle={setTitle} error={error} onError={setError} chat={chat} onPreviewReady={onPreviewReady} /></EditorStateProvider></div>;
}

function Shell({ store, assets, title, onTitle, error, onError, chat: variant, onPreviewReady }: { store: ReturnType<typeof createEditorStore>; assets: MediaAsset[]; title: string; onTitle: (title: string) => void; error: string; onError: (message: string) => void; chat: HeroChat; onPreviewReady: (preview: PreviewHandle) => void }) {
  const timeline = useStore(store, state => state.timeline);
  // Open with the whole film in view, as a finished edit would be reviewed.
  // The panels settle after mount, so refit whenever the timeline's width changes.
  useEffect(() => {
    let observer: ResizeObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const scroll = document.querySelector<HTMLElement>('.landing-demo-editor .timeline-scroll');
      if (!scroll) return;
      observer = new ResizeObserver(() => { if (scroll.clientWidth) store.setState({ zoom: Math.max(.05, (scroll.clientWidth - 28) / (TIMELINE_BASE_PX * FILM_SECONDS)) }); });
      observer.observe(scroll);
    });
    return () => { cancelAnimationFrame(frame); observer?.disconnect(); };
  }, [store]);
  // Only the side chat changes between Revline, Claude and ChatGPT; the preview and timeline stay the same edit.
  const chat = variant === 'claude' ? <ClaudeChat /> : variant === 'chatgpt' ? <ChatGPTChat />
    : <AssistantPanel messages={MESSAGES} running={false} configured demo hasClips onSend={nothing} onStop={nothing} onAttach={noop} attachments={[]} requireMedia={false} />;
  return <EditorShell embedded demo conversationRequest={variant} onPreviewReady={onPreviewReady} title={title} onTitle={onTitle} timeline={timeline} assets={assets} assistantPanel={chat}
    onChange={next => store.getState().edit(next)} saving={false} upload={null} error={error} onError={onError}
    onUndo={() => store.getState().undo()} onRedo={() => store.getState().redo()} canUndo={false} canRedo={false}
    onUpload={nothing} onDropUpload={nothing} messages={MESSAGES} aiRunning={false} aiConfigured={false} onSend={nothing} onStop={nothing} onExport={nothing} exportState={null} />;
}
