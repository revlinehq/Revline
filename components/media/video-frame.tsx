'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import './video-frame.css';

/** A video's first frame as its picture, for a video with no stored poster (one only the Library holds). The video
 *  loads once it is near the screen; its frame is copied to a canvas and the video is then removed, so a long grid
 *  holds no media players. `fallback` shows until the frame is ready, and stays when the browser cannot play it. */
export function VideoFrame({ src, fallback, onSize }: { src: string; fallback?: ReactNode; onSize?: (width: number, height: number) => void }) {
  const host = useRef<HTMLSpanElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  useEffect(() => {
    const node = host.current;
    if (state !== 'idle' || !node) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setState('loading'); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);
  function draw(video: HTMLVideoElement) {
    const target = canvas.current, width = video.videoWidth, height = video.videoHeight;
    if (!target || !width || !height) { setState('failed'); return; }
    // Drawing a frame from another origin only marks the canvas as unreadable; it still shows.
    target.width = width; target.height = height;
    target.getContext('2d')?.drawImage(video, 0, 0, width, height);
    setState('ready');
    onSize?.(width, height);
  }
  return <span ref={host} className="video-frame" data-ready={state === 'ready' || undefined}>
    {state !== 'ready' && fallback}
    <canvas ref={canvas} aria-hidden="true" />
    {state === 'loading' && <video src={`${src}#t=0.1`} muted playsInline preload="auto" tabIndex={-1}
      onLoadedData={event => draw(event.currentTarget)} onError={() => setState('failed')} />}
  </span>;
}
