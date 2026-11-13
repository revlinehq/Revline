'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { drawPoster, posterBlob, seekToPoster } from '@/lib/editor/poster-frame';
import './video-frame.css';

/** A video's poster frame as its picture, for a video with no stored poster yet (one only the Library holds). The
 *  video loads once it is near the screen; the frame every stored poster uses (lib/editor/poster-frame) is copied to
 *  a canvas and the video is then removed, so a long grid holds no media players. `onPoster` receives that frame as a
 *  poster JPEG, so the caller can store it and the next visit loads a picture. `fallback` shows until the frame is
 *  ready, and stays when the browser cannot play the video. */
export function VideoFrame({ src, fallback, onSize, onPoster }: { src: string; fallback?: ReactNode; onSize?: (width: number, height: number) => void; onPoster?: (image: Blob) => void }) {
  const host = useRef<HTMLSpanElement>(null), canvas = useRef<HTMLCanvasElement>(null), drawing = useRef(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  // A frame is readable only when the video loads with CORS. Media links answer this site with it; one that does not
  // fails that load, and the video loads again without it, to be shown but not stored.
  const [cors, setCors] = useState(!!onPoster), live = useRef(0);
  useEffect(() => {
    const node = host.current;
    if (state !== 'idle' || !node) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setState('loading'); observer.disconnect(); } }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [state]);
  async function draw(video: HTMLVideoElement) {
    if (drawing.current) return;
    drawing.current = true;
    const attempt = live.current, reached = await seekToPoster(video);
    // The video failed or was replaced while seeking: its frame is not this one.
    if (attempt !== live.current) return;
    const target = canvas.current;
    if (!target || video.error || !drawPoster(video, target)) { setState('failed'); return; }
    onSize?.(video.videoWidth, video.videoHeight);
    setState('ready');
    // Only the frame at the poster time is stored; a seek that never finished keeps its frame on screen alone.
    if (onPoster && cors && reached) { const image = await posterBlob(target); if (image) onPoster(image); }
  }
  function failed() {
    live.current++; drawing.current = false;
    if (cors) setCors(false); else setState('failed');
  }
  return <span ref={host} className="video-frame" data-ready={state === 'ready' || undefined}>
    {state !== 'ready' && fallback}
    <canvas ref={canvas} aria-hidden="true" />
    {state === 'loading' && <video key={cors ? 'cors' : 'plain'} src={src} crossOrigin={cors ? 'anonymous' : undefined} muted playsInline preload="auto" tabIndex={-1}
      onLoadedData={event => void draw(event.currentTarget)} onError={failed} />}
  </span>;
}
