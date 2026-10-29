'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import type { PreviewHandle } from '@/components/editor/preview';
import { Brand } from '@/components/workspace/brand';
import { ClaudeLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import type { HeroChat } from './hero-editor';

// The Blueprint launch film, made in Revline from screenshots. Swap the export in here (and its waveform in hero-editor.tsx).
const FILM_SRC = '/landing/blueprint-launch-v2.mp4';
const FILM_POSTER = '/landing/blueprint-launch-v2-poster.webp';

// The real editor is large, so it loads only once the hero is close to the screen.
const LandingHeroEditor = dynamic(() => import('./hero-editor'), { ssr: false });

const VIEWS: { id: HeroChat; label: string; Logo: (props: { className?: string }) => React.ReactNode }[] = [
  { id: 'revline', label: 'Revline', Logo: ({ className }) => <Brand markOnly className={className} /> },
  { id: 'claude', label: 'Claude', Logo: ({ className }) => <ClaudeLogo className={className} width={14} height={14} /> },
  { id: 'chatgpt', label: 'ChatGPT', Logo: ({ className }) => <OpenAILogo className={className} width={14} height={14} /> },
];

/** Hero demo: the launch film playing in Revline's real editor, driven from Revline's own chat, Claude or ChatGPT. */
export function LandingHeroDemo() {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<PreviewHandle | null>(null);
  const [view, setView] = useState<HeroChat>('revline');
  const [film, setFilm] = useState<string | null>(null);
  const visible = useRef(false);

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
    if (visible.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) preview.current?.play();
  }
  function onPreviewReady(handle: PreviewHandle) {
    const first = !preview.current;
    preview.current = handle;
    if (first) autoplay();
  }

  const index = VIEWS.findIndex(item => item.id === view);
  return <div ref={root} className="landing-demo">
    <div className="landing-product-frame">
      <div className="landing-demo-stage">
        <div className="landing-demo-editor">
          {film ? <LandingHeroEditor url={film} poster={FILM_POSTER} chat={view} onPreviewReady={onPreviewReady} />
            : <img className="landing-demo-poster" src={FILM_POSTER} alt="" width={1600} height={900} />}
        </div>
      </div>
    </div>
    <div className="landing-demo-switch" role="tablist" aria-label="Who drives the edit" style={{ '--switch-index': index } as CSSProperties}>
      <span className="landing-demo-switch-pill" aria-hidden="true" />
      {VIEWS.map(({ id, label, Logo }) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}><Logo className="landing-demo-switch-logo" />{label}</button>)}
    </div>
  </div>;
}
