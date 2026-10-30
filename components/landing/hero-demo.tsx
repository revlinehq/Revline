'use client';
import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PreviewHandle } from '@/components/editor/preview';

// The Blueprint launch film, made in Revline from screenshots. Swap the export in here (and its waveform in hero-editor.tsx).
const FILM_SRC = '/landing/blueprint-launch-v2.mp4';
const FILM_POSTER = '/landing/blueprint-launch-v2-poster.webp';

// The real editor is large, so it loads only once the hero is close to the screen.
const LandingHeroEditor = dynamic(() => import('./hero-editor'), { ssr: false });

/** Hero demo: the launch film playing in Revline's real editor, next to the chat that made it. */
export function LandingHeroDemo() {
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<PreviewHandle | null>(null);
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

  return <div ref={root} className="landing-demo">
    <div className="landing-product-frame">
      <div className="landing-demo-stage">
        <div className="landing-demo-editor">
          {film ? <LandingHeroEditor url={film} poster={FILM_POSTER} onPreviewReady={onPreviewReady} />
            : <img className="landing-demo-poster" src={FILM_POSTER} alt="" width={1600} height={900} />}
        </div>
      </div>
    </div>
  </div>;
}
