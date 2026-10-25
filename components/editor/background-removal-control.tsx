'use client';
import { userError } from '@/lib/user-error';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { LoaderCircle, Undo2, UserRoundX } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { Clip, MediaAsset } from '@/lib/editor/types';
import './background-removal-control.css';

/** Ultra: replace a video clip's background with transparency (fal.ai), so layers below show through. */
export function BackgroundRemovalControl({ projectId, clip, asset, readOnly }: { projectId: Id<'projects'>; clip: Clip; asset?: MediaAsset; readOnly?: boolean }) {
  const cutouts = useQuery(api.cutouts.forProject, { projectId });
  const start = useMutation(api.cutouts.start), restore = useMutation(api.cutouts.restore);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const latest = cutouts?.find(row => row.clipId === clip.id);
  const removed = !!asset?.cutoutOf;
  const running = latest?.status === 'queued';

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(userError(cause, 'Background removal could not start. Please try again.')); }
    finally { setBusy(false); }
  }

  return <div className="background-removal">
    <div className="background-removal-row">
      <div><strong>Background</strong><small>{removed ? 'Removed. Layers below now show through.' : running ? `Removing… ${latest?.progress ? `${Math.round(latest.progress)}%` : 'queued'}` : 'Cut yourself out and put visuals on a lower layer.'}</small></div>
      {removed
        ? <button type="button" className="workspace-outline-button" disabled={busy || readOnly} onClick={() => void act(async () => { await restore({ projectId, clipId: clip.id }); })}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Undo2 size={13} />}Restore</button>
        : <button type="button" className="workspace-outline-button" disabled={busy || running || readOnly} onClick={() => void act(async () => { const result = await start({ projectId, clipId: clip.id }); if (!result.reused) setNotice(`About $${result.estimatedUsd.toFixed(2)} of fal.ai credit. The clip switches automatically when it is ready.`); })}>{busy || running ? <LoaderCircle size={13} className="animate-spin" /> : <UserRoundX size={13} />}Remove</button>}
    </div>
    {notice && running && <p className="background-removal-note">{notice}</p>}
    {latest?.status === 'failed' && !removed && <p className="workspace-inline-error" role="alert">{latest.error ?? 'Background removal failed.'}</p>}
    {latest?.status === 'completed' && latest.placed === false && !removed && <p className="background-removal-note">The cut-out is saved in your media; this clip changed while it was processing, so add it from Media.</p>}
    {error && <p className="workspace-inline-error" role="alert">{error}</p>}
  </div>;
}
