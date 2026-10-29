'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import type { PreviewHandle } from '@/components/editor/preview';
import { ClaudeLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { LandingInstallAgents } from './install-agents';

// The Blueprint launch film, made in Revline from screenshots. Swap the export in here (and its waveform in hero-editor.tsx).
const FILM_SRC = '/landing/blueprint-launch-v2.mp4';
const FILM_POSTER = '/landing/blueprint-launch-v2-poster.webp';

// The real editor is large, so it loads only once the hero is close to the screen.
const LandingHeroEditor = dynamic(() => import('./hero-editor'), { ssr: false });

// Screenshots of Revline working inside each app. Until they exist (src null) the panel shows a quiet stand-in.
// Wanted: public/landing/agents/claude.webp and public/landing/agents/chatgpt.webp, 16:9, about 2560x1440.
const AGENT_SHOTS = {
  claude: { name: 'Claude', Logo: ClaudeLogo, src: null as string | null, prompt: 'Turn these screenshots into a 30 second launch film.' },
  chatgpt: { name: 'ChatGPT', Logo: OpenAILogo, src: null as string | null, prompt: 'Cut the pauses and add captions to my podcast clip.' },
};

type View = 'revline' | keyof typeof AGENT_SHOTS;
const VIEWS: { id: View; label: string }[] = [{ id: 'revline', label: 'Revline' }, { id: 'claude', label: 'Claude' }, { id: 'chatgpt', label: 'ChatGPT' }];

function AgentShot({ id, active }: { id: keyof typeof AGENT_SHOTS; active: boolean }) {
  const { name, Logo, src, prompt } = AGENT_SHOTS[id];
  return <div className="landing-demo-agent" inert={!active}>
    {src ? <img className="landing-demo-shot" src={src} alt={`Revline editing a video inside ${name}`} loading="lazy" decoding="async" />
      : <div className="landing-demo-standin">
        <Logo width={28} height={28} aria-hidden="true" />
        <p className="landing-demo-standin-prompt">{prompt}</p>
        <p className="landing-demo-standin-note">Revline edits the video while you talk to {name}.</p>
      </div>}
    <div className="landing-demo-caption">
      <span>Revline inside {name}</span>
      <LandingInstallAgents variant="neutral" size="sm" initial={id} label={`Install on ${name}`} />
    </div>
  </div>;
}

/** Hero demo: the launch film playing in Revline's real editor, and Revline seen from inside Claude and ChatGPT. */
export function LandingHeroDemo() {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<PreviewHandle | null>(null);
  const [view, setView] = useState<View>('revline');
  const [film, setFilm] = useState<string | null>(null);
  const visible = useRef(false), viewRef = useRef<View>('revline');

  // The hosted assets answer without byte ranges, so a streamed film can't seek past what it has buffered.
  // Near the screen, fetch the whole file once and give the editor an in-memory copy, which seeks anywhere.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let url = '';
    const controller = new AbortController();
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      void fetch(FILM_SRC, { signal: controller.signal }).then(response => response.ok ? response.blob() : null)
        .then(blob => { url = blob ? URL.createObjectURL(blob) : FILM_SRC; setFilm(url); })
        .catch(() => { if (!controller.signal.aborted) setFilm(FILM_SRC); });
    }, { rootMargin: '400px' });
    observer.observe(element);
    return () => { observer.disconnect(); controller.abort(); if (url.startsWith('blob:')) URL.revokeObjectURL(url); };
  }, []);

  // Plays only while it is on screen and selected; reduced motion waits for the editor's play button.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (!entry.isIntersecting) preview.current?.pause();
      else autoplay();
    }, { threshold: 0.35 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function autoplay() {
    if (visible.current && viewRef.current === 'revline' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) preview.current?.play();
  }
  function onPreviewReady(handle: PreviewHandle) {
    const first = !preview.current;
    preview.current = handle;
    if (first) autoplay();
  }
  function pick(next: View) {
    setView(next);
    viewRef.current = next;
    if (next !== 'revline') preview.current?.pause();
    else autoplay();
  }

  const index = VIEWS.findIndex(item => item.id === view);
  return <div ref={root} className="landing-demo">
    <div className="landing-product-frame">
      <div className="landing-demo-stage">
        <div className="landing-demo-panel landing-demo-editor" data-active={view === 'revline' || undefined} inert={view !== 'revline'}>
          {film ? <LandingHeroEditor url={film} poster={FILM_POSTER} onPreviewReady={onPreviewReady} />
            : <img className="landing-demo-poster" src={FILM_POSTER} alt="" width={1600} height={900} />}
        </div>
        {(Object.keys(AGENT_SHOTS) as (keyof typeof AGENT_SHOTS)[]).map(id => <div key={id} className="landing-demo-panel" data-active={view === id || undefined}><AgentShot id={id} active={view === id} /></div>)}
      </div>
    </div>
    <div className="landing-demo-switch" role="tablist" aria-label="Where Revline runs" style={{ '--switch-index': index } as CSSProperties}>
      <span className="landing-demo-switch-pill" aria-hidden="true" />
      {VIEWS.map(item => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => pick(item.id)}>{item.label}</button>)}
    </div>
  </div>;
}
