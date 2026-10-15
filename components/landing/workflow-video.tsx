'use client';

import { useEffect, useRef } from 'react';

/** Silent footage for the workflow illustration; only plays while it is visible. */
export function WorkflowVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let visible = false;
    const update = () => {
      if (visible && document.visibilityState === 'visible') void video.play().catch(() => {});
      else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .2 });
    observer.observe(video);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', update); video.pause(); };
  }, [src]);
  return <video ref={ref} src={src} poster={poster} width={1280} height={720} muted playsInline loop preload="none" disablePictureInPicture aria-hidden="true" />;
}
