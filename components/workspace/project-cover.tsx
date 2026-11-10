'use client';

import { useEffect, useRef, useState } from 'react';
import { Film } from 'lucide-react';

/** A project's cover: its poster image, or the first frame of footage that has no poster yet.
 * Images are sized and lazy. A video mounts only once its row is near the viewport, since each one costs
 * range requests for the file's header and first frame; the box looks the same either way until a frame shows. */
export function ProjectCover({ url, kind }: { url: string | null; kind: 'video' | 'image' | null }) {
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => { setFailed(false); }, [url]);
  const lazyVideo = kind === 'video' && !!url && !failed && !near;
  useEffect(() => {
    const node = root.current;
    if (!lazyVideo || !node) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setNear(true); observer.disconnect(); } }, { rootMargin: '200px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [lazyVideo]);
  return <span ref={root} className="workspace-chat-cover" aria-hidden="true">
    {url && !failed ? kind === 'video'
      ? near ? <video src={`${url}#t=.1`} muted playsInline preload="metadata" width={42} height={56} onError={() => setFailed(true)} /> : null
      : <img src={url} alt="" width={42} height={56} loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <Film size={18} strokeWidth={1.5} />}
  </span>;
}
