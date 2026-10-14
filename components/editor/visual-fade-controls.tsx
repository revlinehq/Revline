'use client';

import type { Clip } from '@/lib/editor/types';
import { visualFadeSettings, visualFadePatch } from '@/lib/editor/visual-fades';
import { FadeControls } from './fade-controls';
import './audio-controls.css';

export function VisualFadeControls({ clip, fps = 30, onChange, onPreview }: {
  clip: Clip; fps?: number; onChange(patch: Partial<Clip>): void;
  onPreview?(patch: Partial<Clip> | null): void;
}) {
  if (clip.kind !== 'video' && clip.kind !== 'image') return null;
  const settings = visualFadeSettings(clip);
  const maximum = { fadeIn: Math.max(0, clip.duration - settings.fadeOut), fadeOut: Math.max(0, clip.duration - settings.fadeIn) };
  return <div className="visual-fade-controls audio-controls" aria-label="Visual fades"><FadeControls settings={settings} maximum={maximum} fps={fps}
    onChange={patch => onChange(visualFadePatch(clip, patch))}
    onPreview={patch => onPreview?.(patch === null ? null : visualFadePatch(clip, patch))}/></div>;
}
