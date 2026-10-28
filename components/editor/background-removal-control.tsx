'use client';
import { userError } from '@/lib/user-error';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { LoaderCircle, Scissors, Undo2, UserRoundX } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { Clip, MediaAsset } from '@/lib/editor/types';
import './background-removal-control.css';
import { Button } from '@/components/ui/button';

/** Replace a video clip's background with transparency (fal.ai), so layers below show through.
 * The person is kept by default; naming an object keeps only that object (SAM 3). */
export function BackgroundRemovalControl({ projectId, clip, asset, readOnly }: { projectId: Id<'projects'>; clip: Clip; asset?: MediaAsset; readOnly?: boolean }) {
  const cutouts = useQuery(api.cutouts.forProject, { projectId });
  const start = useMutation(api.cutouts.start), restore = useMutation(api.cutouts.restore);
  const [busy, setBusy] = useState<'person' | 'object' | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [subject, setSubject] = useState('');
  const latest = cutouts?.find(row => row.clipId === clip.id);
  const removed = !!asset?.cutoutOf;
  const kept = removed ? cutouts?.find(row => row.outputAssetId === asset?._id)?.subject : undefined;
  const running = latest?.status === 'queued';

  async function act(work: () => Promise<void>) {
    setError(''); setNotice('');
    try { await work(); } catch (cause) { setError(userError(cause, 'Background removal could not start. Please try again.')); }
    finally { setBusy(null); }
  }
  const begin = (object?: string) => { setBusy(object ? 'object' : 'person'); return act(async () => {
    const result = await start({ projectId, clipId: clip.id, ...(object ? { subject: object } : {}) });
    if (!result.reused) setNotice(`About $${result.estimatedUsd.toFixed(2)} of fal.ai credit. The clip switches automatically when it is ready.`);
  }); };
  // Which button spins: the running cut-out's kind, else the one just pressed.
  const working = running ? (latest?.subject ? 'object' : 'person') : busy;

  return <div className="background-removal">
    <div className="background-removal-row">
      <div><strong>Background</strong><small>{removed ? (kept ? `Only the ${kept} is kept. Layers below show through.` : 'Removed. Layers below now show through.') : running ? `${latest?.subject ? `Cutting out the ${latest.subject}` : 'Removing'}… ${latest?.progress ? `${Math.round(latest.progress)}%` : 'queued'}` : 'Cut yourself out and put visuals on a lower layer.'}</small></div>
      {removed
        ? <Button variant="outline" size="md" type="button" disabled={!!busy || readOnly} onClick={() => { setBusy('person'); void act(async () => { await restore({ projectId, clipId: clip.id }); }); }}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <Undo2 size={13} />}Restore</Button>
        : <Button variant="outline" size="md" type="button" disabled={!!busy || running || readOnly} onClick={() => void begin()}>{working === 'person' ? <LoaderCircle size={13} className="animate-spin" /> : <UserRoundX size={13} />}Remove</Button>}
    </div>
    {!removed && <form className="background-removal-object" onSubmit={event => { event.preventDefault(); if (subject.trim()) void begin(subject); }}>
      <input value={subject} maxLength={60} placeholder="Or keep only an object, e.g. phone" aria-label="Object to keep" disabled={!!busy || running || readOnly} onChange={event => setSubject(event.target.value)} />
      <Button variant="outline" size="md" type="submit" disabled={!!busy || running || readOnly || !subject.trim()}>{working === 'object' ? <LoaderCircle size={13} className="animate-spin" /> : <Scissors size={13} />}Cut out</Button>
    </form>}
    {notice && running && <p className="background-removal-note">{notice}</p>}
    {latest?.status === 'failed' && !removed && <p className="workspace-inline-error" role="alert">{latest.error ?? 'Background removal failed.'}</p>}
    {latest?.status === 'completed' && latest.placed === false && !removed && <p className="background-removal-note">The cut-out is saved in your media; this clip changed while it was processing, so add it from Media.</p>}
    {error && <p className="workspace-inline-error" role="alert">{error}</p>}
  </div>;
}
