'use client';

import { useState } from 'react';
import type { Clip } from '@/lib/editor/types';
import { SCENE_LIMITS, validateScene } from '@/lib/editor/scene-layers';

/** Title and code for a scene clip. Code applies on demand so half-typed JSX never reaches the preview. */
export function SceneControls({ clip, onChange, readOnly = false }: { clip: Clip; onChange: (patch: Partial<Clip>) => void; readOnly?: boolean }) {
  const scene = clip.scene ?? { title: 'Scene', code: '' };
  const [title, setTitle] = useState(scene.title);
  const [code, setCode] = useState(scene.code);
  const [error, setError] = useState<string | null>(null);
  const dirty = title !== scene.title || code !== scene.code;
  function apply() {
    const next = { title: title.trim(), code };
    try { validateScene({ kind: 'scene', scene: next }); } catch (problem) { setError(problem instanceof Error ? problem.message : String(problem)); return; }
    setError(null); onChange({ scene: next });
  }
  return <div className="visual-effects-controls scene-controls" aria-label="Scene settings">
    <div className="inspector-selection"><small>Scene</small><p>{scene.title}</p></div>
    <label className="scene-controls-field">Title<input value={title} maxLength={SCENE_LIMITS.title} disabled={readOnly} onChange={event => setTitle(event.target.value)}/></label>
    <label className="scene-controls-field">Code<textarea value={code} spellCheck={false} maxLength={SCENE_LIMITS.code} disabled={readOnly} rows={18} onChange={event => setCode(event.target.value)}/></label>
    {error && <p className="scene-controls-error" role="alert">{error}</p>}
    <div className="scene-controls-actions">
      <button type="button" className="effect-color-reset" disabled={readOnly || !dirty} onClick={apply}>Apply code</button>
      <button type="button" className="effect-color-reset" disabled={readOnly || !dirty} onClick={() => { setTitle(scene.title); setCode(scene.code); setError(null); }}>Revert</button>
    </div>
    <p className="visual-control-note">A React component drawn from the scene&apos;s clock. Ask the assistant to change it, or edit the code here. Trim the clip to change its length; render errors appear as preview errors.</p>
  </div>;
}
