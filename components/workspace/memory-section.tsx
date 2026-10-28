'use client';
import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { X } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import './memory-section.css';
import { Button } from '@/components/ui/button';

/** What the editing AI remembers about you: lasting preferences and styles it reuses across projects. */
export function MemorySection() {
  const { isAuthenticated } = useConvexAuth();
  const memories = useQuery(api.memories.list, isAuthenticated ? {} : 'skip');
  const remove = useMutation(api.memories.remove);
  return <section className="workspace-profile-section">
    <div className="workspace-section-label"><h2>Memory</h2><p>Preferences and styles the AI reuses across your projects. It learns them as you edit.</p></div>
    <div className="workspace-section-content">
      {!memories?.length ? <p className="memory-empty">Nothing yet. Tell the AI what you like, or that it nailed an edit, and it will remember.</p>
        : <ul className="memory-list">{memories.map(item => <li key={item.memoryId}>
          <div className="memory-text">
            {item.kind === 'style' && <strong>{item.name}</strong>}
            <span>{item.text}</span>
            {(item.project || item.uses > 0) && <small>{[item.project && `Only in ${item.project}`, item.uses > 0 && `Used ${item.uses}×`].filter(Boolean).join(' · ')}</small>}
          </div>
          <Button variant="ghost" size="icon-sm" type="button" aria-label={`Forget ${item.name ?? item.text}`} onClick={() => void remove({ memoryId: item.memoryId })}><X size={14} /></Button>
        </li>)}</ul>}
    </div>
  </section>;
}
