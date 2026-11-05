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
    const compact = matchMedia('(max-width: 700px)');
    let visible = false;
    let fallback = false;
    const playback = createLandingVideoPlayback(video, (reason) => {
      fallback = reason !== null;
      video.controls = reduced.matches || compact.matches || fallback;
    });
    const update = () => {
      video.controls = reduced.matches || compact.matches || fallback;
      playback.setPlaying(visible && !reduced.matches && !compact.matches);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(video);
    reduced.addEventListener('change', update);
    compact.addEventListener('change', update);
    update();
    return () => {
      observer.disconnect();
      reduced.removeEventListener('change', update);
      compact.removeEventListener('change', update);
      playback.dispose();
    };
  }, [src]);
  return ref;
}
