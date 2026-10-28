'use client';
import { userError } from '@/lib/user-error';

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { LoaderCircle, Play } from 'lucide-react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { CUTOUT_EFFECTS, CUTOUT_EFFECT_INFO, type CutoutEffectKind } from '@/lib/editor/cutout-effects';
import type { Clip, MediaAsset } from '@/lib/editor/types';
import './cutout-effects-lab.css';
import { Button } from '@/components/ui/button';

/** Development only: run each cut-out effect for real (fal person matting or SAM 3) with
 * fixed settings and no AI, to see exactly what the assistant's tools will produce. */
export function CutoutEffectsLab({ projectId, clip, asset }: { projectId: Id<'projects'>; clip?: Clip; asset?: MediaAsset }) {
  const cutouts = useQuery(api.cutouts.forProject, { projectId });
  const start = useMutation(api.cutouts.start);
  const [inputs, setInputs] = useState<Partial<Record<CutoutEffectKind, string>>>({});
  // Person effects default to person matting; SAM 3 ("person") is here to compare edges and cost.
  const [samForPeople, setSamForPeople] = useState(false);
  const [busy, setBusy] = useState<CutoutEffectKind | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  if (clip?.kind !== 'video') return <p className="cutout-lab-note">Select a video clip on the timeline. Each effect makes a real fal.ai call.</p>;
  if (asset?.cutoutOf) return <p className="cutout-lab-note">This clip is already a cut-out. Select the original footage.</p>;
  const latest = cutouts?.find(row => row.clipId === clip.id);
  const running = latest?.status === 'queued';

  async function run(kind: CutoutEffectKind) {
    const info = CUTOUT_EFFECT_INFO[kind], value = inputs[kind]?.trim();
    setBusy(kind); setError(''); setNotice('');
    try {
      const result = await start({ projectId, clipId: clip!.id, effect: { kind, ...(kind === 'text-behind' && value ? { text: value } : {}) }, ...(info.target === 'object' ? { subject: value || info.defaultSubject } : samForPeople ? { subject: 'person' } : {}) });
      setNotice(result.reused ? 'Reused an existing cut-out; the effect is applied.' : result.alreadyRunning ? 'Already running for this clip.' : `Started: about $${result.estimatedUsd.toFixed(2)} of fal.ai credit.`);
    } catch (cause) { setError(userError(cause, 'The effect could not start.')); }
    finally { setBusy(null); }
  }

  return <div className="cutout-lab">
    <p className="cutout-lab-note">Real fal.ai calls, fixed settings, no AI. The original stays underneath; the effect is built from it and the cut-out.</p>
    <div className="cutout-lab-engines" role="radiogroup" aria-label="Cut-out engine for person effects">
      <span>You:</span>
      <button type="button" role="radio" aria-checked={!samForPeople} onClick={() => setSamForPeople(false)}>Background removal</button>
      <button type="button" role="radio" aria-checked={samForPeople} onClick={() => setSamForPeople(true)}>SAM 3</button>
    </div>
    {CUTOUT_EFFECTS.map(kind => {
      const info = CUTOUT_EFFECT_INFO[kind], field = kind === 'text-behind' ? 'BEHIND ME' : info.defaultSubject;
      return <div key={kind} className="cutout-lab-effect">
        <div className="cutout-lab-head">
          <div><strong>{info.label}</strong><small>{info.description}</small></div>
          <span className="cutout-lab-engine">{info.target === 'person' && !samForPeople ? 'Background removal · ~$0.02/s' : 'SAM 3 · ~$0.01/s'}</span>
        </div>
        <div className="cutout-lab-row">
          {field && <input value={inputs[kind] ?? ''} maxLength={kind === 'text-behind' ? 80 : 60} placeholder={kind === 'text-behind' ? `Text, e.g. ${field}` : `Object, e.g. ${field}`} aria-label={`${info.label} ${kind === 'text-behind' ? 'text' : 'object'}`} onChange={event => setInputs(current => ({ ...current, [kind]: event.target.value }))} />}
          <Button variant="outline" size="md" type="button" disabled={!!busy || running} onClick={() => void run(kind)}>{busy === kind || (running && latest?.effect === kind) ? <LoaderCircle size={13} className="animate-spin" /> : <Play size={13} />}Run</Button>
        </div>
      </div>;
    })}
    {running && <p className="cutout-lab-status" role="status">{latest?.effect ? CUTOUT_EFFECT_INFO[latest.effect as CutoutEffectKind]?.label : 'Cut-out'}{latest?.subject ? ` (${latest.subject})` : ''}… {latest?.progress ? `${Math.round(latest.progress)}%` : 'queued'}</p>}
    {!running && notice && <p className="cutout-lab-status">{notice}</p>}
    {latest?.status === 'failed' && <p className="workspace-inline-error" role="alert">{latest.error ?? 'The cut-out failed.'}</p>}
    {latest?.status === 'completed' && latest.placed === false && <p className="workspace-inline-error" role="alert">{latest.error ?? 'The clip changed while processing; the cut-out is in Media.'}</p>}
    {error && <p className="workspace-inline-error" role="alert">{error}</p>}
  </div>;
}
