'use client';

import { useEffect, useRef } from 'react';
import { createLandingVideoPlayback } from './video-playback';

/** Load only visible films, and leave a playable poster when autoplay is unavailable. */
export function useLandingVideoPlayback(src?: string) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || !src) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let fallback = false;
    const playback = createLandingVideoPlayback(video, (reason) => {
      fallback = reason !== null;
      video.controls = reduced.matches || fallback;
    });
    const update = () => {
      video.controls = reduced.matches || fallback;
      playback.setPlaying(visible && !reduced.matches);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(video);
    reduced.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      reduced.removeEventListener('change', update);
      playback.dispose();
    };
  }, [src]);
  return ref;
}
