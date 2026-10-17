'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Check } from 'lucide-react';
import { ChatProse } from '@/components/editor/chat-prose';
import { ProcessingStatus } from '@/components/editor/processing-status';
import { EditorShell } from '@/components/editor/editor-shell';
import { EditorStateProvider } from '@/components/editor/editor-state';
import { F1Preview, F1_VIDEO_URL } from './f1-preview';
import { Brand } from '@/components/workspace/brand';
import { EditComposer } from '@/components/workspace/edit-composer';
import { createEditorStore } from '@/lib/editor/store';
import { LANDING_DEMO_ASSETS, LANDING_DEMO_MESSAGES, LANDING_DEMO_PROMPT, LANDING_DEMO_STEPS, LANDING_DEMO_VIDEO } from './demo-story';
import '@/app/editor.css';
import '@/components/editor/assistant-panel.css';
import '@/components/editor/assistant-editing.css';

const noop = () => {};
const noRequest = async () => {};
const TYPE_INTERVAL = 32;
const FINISHED_STAGE = LANDING_DEMO_STEPS.length + 1;

/** Keep per-character updates inside the actual composer, away from the preview/timeline. */
function DemoComposer({ typing, active, running }: { typing: boolean; active: boolean; running: boolean }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText('');
    if (!typing || !active) return;
    let characters = 0;
    const timer = window.setInterval(() => { characters++; setText(LANDING_DEMO_PROMPT.slice(0, characters)); if (characters >= LANDING_DEMO_PROMPT.length) clearInterval(timer); }, TYPE_INTERVAL);
    return () => clearInterval(timer);
  }, [typing, active]);
  return <div className="manual-composer-dock"><EditComposer variant="compact" className="manual-editor-composer" value={text} onChange={noop} onSubmit={noRequest} onAttach={noop} running={running} onStop={noRequest} placeholder="What would you change next?" attachments={typing ? [{ id: 'landing-source', name: LANDING_DEMO_VIDEO.name, kind: 'image', url: LANDING_DEMO_VIDEO.poster }] : undefined}/></div>;
}

function DemoReply({ text, active, reducedMotion }: { text: string; active: boolean; reducedMotion: boolean }) {
  const [shown, setShown] = useState(reducedMotion ? text : '');
  const revealed = useRef(shown);
  const prose = useRef<HTMLDivElement>(null);
  revealed.current = shown;
  useEffect(() => {
    if (reducedMotion) { setShown(text); return; }
    if (!active) return;
    let current = text.startsWith(revealed.current) ? revealed.current : '';
    const words = text.slice(current.length).match(/\s*\S+/g) ?? [];
    if (!words.length) return;
    let count = 0;
    const timer = window.setInterval(() => { current += words[count++]; setShown(current); if (count >= words.length) clearInterval(timer); }, 55);
    return () => clearInterval(timer);
  }, [text, active, reducedMotion]);
  useLayoutEffect(() => {
    const history = prose.current?.closest('.assistant-history');
    if (history) history.scrollTop = history.scrollHeight;
  }, [shown]);
  return <div ref={prose} className="landing-demo-reply"><ChatProse text={shown} animate={active && !reducedMotion}/></div>;
}

function DemoConversation({ stage, index, active, reducedMotion }: { stage: number; index: number; active: boolean; reducedMotion: boolean }) {
  const sent = stage > 0;
  const building = sent && stage < FINISHED_STAGE;
  return <div className="assistant-content">
    <div className="assistant-history"><div className="assistant-turns">{sent ? <div className="assistant-turn is-latest-turn">
      <article className="chat-message chat-user"><p>{LANDING_DEMO_PROMPT}</p></article>
      <div className="assistant-reply"><div className={`assistant-reply-header ${building ? 'is-processing' : 'chat-author'}`}><Brand markOnly/>{building ? <ProcessingStatus label={['Finding the moments…', 'Placing the cuts…', 'Adding titles…', 'Polishing the motion…'][index]} brand={false}/> : <span>Revline</span>}</div>
        <article className="chat-message chat-assistant"><DemoReply text={LANDING_DEMO_MESSAGES.slice(0, index + 1).join('\n\n')} active={active} reducedMotion={reducedMotion}/>{!building && ['Six clips arranged', 'Animated titles added', 'Subtle motion applied'].map(label => <div className="tool-result" key={label}><Check size={12}/>{label}</div>)}</article>
      </div>
    </div> : <div className="assistant-welcome"><h3>What are we making?</h3><p>Your footage is ready. Tell Revline the story you want to make.</p></div>}</div></div>
    <DemoComposer typing={!sent} active={active} running={building}/>
  </div>;
}

function CompactPrompt({ stage, active }: { stage: number; active: boolean }) {
  return <div className="landing-compact-prompt">{stage === 0 ? <DemoComposer typing active={active} running={false}/> : <div className="landing-compact-sent">
    <p>{LANDING_DEMO_PROMPT}</p><ProcessingStatus label={stage < FINISHED_STAGE ? 'Building your cinematic edit…' : 'Your edit is ready.'} state={stage < FINISHED_STAGE ? 'working' : 'ready'}/>
  </div>}</div>;
}

/** The editor's conversation and timeline, with an attributed F1 film in the preview. */
export function ProductDemo() {
  const root = useRef<HTMLElement>(null);
  const [store] = useState(() => {
    const instance = createEditorStore(LANDING_DEMO_STEPS[0].timeline);
    instance.setState({ muted: true, compactTracks: true, zoom: .16 });
    return instance;
  });
  const timeline = useStore(store, state => state.timeline);
  const [stage, setStage] = useState(0);
  const [ready, setReady] = useState(false);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [compact, setCompact] = useState(false);

  // The requested product story autoplays; Reduced Motion removes its decorative transitions.
  const active = visible && pageVisible;
  const step = LANDING_DEMO_STEPS[Math.max(0, Math.min(stage - 1, LANDING_DEMO_STEPS.length - 1))];
  const focus = stage === FINISHED_STAGE ? 0 : step.at;
  const latest = useRef({ active, stage, focus });
  latest.current = { active, stage, focus };

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const size = matchMedia('(max-width: 900px)');
    const motion = () => setReducedMotion(preference.matches);
    const layout = () => setCompact(size.matches);
    const visibility = () => setPageVisible(document.visibilityState === 'visible');
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .15 });
    if (root.current) observer.observe(root.current);
    motion(); layout(); visibility();
    preference.addEventListener('change', motion);
    size.addEventListener('change', layout);
    document.addEventListener('visibilitychange', visibility);
    return () => { observer.disconnect(); preference.removeEventListener('change', motion); size.removeEventListener('change', layout); document.removeEventListener('visibilitychange', visibility); };
  }, []);

  const previewReady = useCallback(() => setReady(true), []);
  const previewTime = useCallback((time: number) => {
    if (latest.current.stage === 0 || latest.current.stage === FINISHED_STAGE) {
      store.setState({ playhead: Math.min(time, LANDING_DEMO_VIDEO.duration), playing: true });
    }
  }, [store]);

  useEffect(() => {
    store.getState().replace(step.timeline);
  }, [step, store]);

  useEffect(() => {
    if (!active || !ready) { store.setState({ playing: false }); return; }
    store.setState({ playhead: focus, playing: false });
    const delay = stage === FINISHED_STAGE ? (LANDING_DEMO_VIDEO.duration + .8) * 1000 : stage === 0 ? LANDING_DEMO_PROMPT.length * TYPE_INTERVAL + 800 : step.message === 1 ? 800 : 1100;
    const timer = window.setTimeout(() => setStage(value => value === FINISHED_STAGE ? 0 : value + 1), delay);
    return () => clearTimeout(timer);
  }, [active, ready, stage, focus, step, store]);

  const building = stage > 0 && stage < FINISHED_STAGE;
  const message = stage === FINISHED_STAGE ? LANDING_DEMO_MESSAGES.length - 1 : step.message;
  return <><section ref={root} className="landing-product-demo" role="img" aria-label="Revline’s sample editor layout with Prime Editx’s F1 × NO BATIDAO edit playing in the preview." data-story-stage={stage} data-story-active={active} data-building={building || undefined}>
    <div className="landing-passive-editor" inert aria-hidden="true">
      {compact && <CompactPrompt stage={stage} active={active && ready}/>}
      <EditorStateProvider store={store}><EditorShell embedded demo title="Race day" timeline={timeline} assets={LANDING_DEMO_ASSETS} onChange={noop} onTitle={noop} saving={false} upload={null} error="" onError={noop} onUndo={noop} onRedo={noop} canUndo={false} canRedo={false}
        assistantPanel={compact ? <div/> : <DemoConversation stage={stage} index={message} active={active && ready} reducedMotion={reducedMotion}/>}
        previewContent={<F1Preview active={active} onReady={previewReady} onTime={previewTime}/>} messages={[]} aiRunning={building} aiConfigured={false} onSend={noRequest} onUpload={noRequest} onDropUpload={noRequest} onExport={noRequest} exportState={null}/></EditorStateProvider>
    </div>
  </section><p className="landing-demo-credit">Featured edit: <a href={F1_VIDEO_URL} target="_blank" rel="noreferrer">F1 × NO BATIDAO · Prime Editx</a></p></>;
}
