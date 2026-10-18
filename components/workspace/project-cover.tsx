'use client';

import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';

export function ProjectCover({ url, kind }: { url: string | null; kind: 'video' | 'image' | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className="workspace-chat-cover" aria-hidden="true">
    {url && !failed ? kind === 'video'
      ? <video src={`${url}#t=.1`} muted playsInline preload="metadata" onError={() => setFailed(true)} />
      : <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      : <Film size={18} strokeWidth={1.5} />}
  </span>;
}
