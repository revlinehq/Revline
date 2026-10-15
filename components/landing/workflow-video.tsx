'use client';

import { useEffect, useRef } from 'react';

/** Silent footage for the workflow illustration; only plays while it is visible. */
export function WorkflowVideo({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => {
      if (visible && !motion.matches && document.visibilityState === 'visible') {
        if (!video.getAttribute('src')) video.src = src;
        void video.play().catch(() => {});
      } else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); }, { threshold: .2 });
    observer.observe(video);
    motion.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); motion.removeEventListener('change', update); document.removeEventListener('visibilitychange', update); video.pause(); };
  }, [src]);
  return <video ref={ref} poster={poster} width={180} height={240} muted playsInline loop preload="none" disablePictureInPicture aria-hidden="true" />;
}
