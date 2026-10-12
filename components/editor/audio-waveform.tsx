'use client';
import { memo, useEffect, useMemo, useRef, type RefObject } from 'react';
import { VolumeX } from 'lucide-react';
import { decodeWaveform, waveformBars } from '@/lib/editor/audio-waveform';
import type { AudioWaveform as Waveform } from '@/lib/editor/types';

export const AudioWaveform = memo(function AudioWaveform({ waveform, sourceStart, duration, volume = 1, timelineStart, viewport }: {
  waveform?: Waveform; sourceStart: number; duration: number; volume?: number; timelineStart: number; viewport: RefObject<HTMLDivElement | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const data = useMemo(() => waveform ? decodeWaveform(waveform) : null, [waveform]);
  const muted = volume === 0;
  useEffect(() => {
    const node = root.current, surface = canvas.current, rail = viewport.current;
    if (!node || !surface || !rail || !data) return;
    let frame = 0, timing = { sourceStart, duration }, gain = volume;
    const draw = () => {
      frame = 0;
      const clip = node.getBoundingClientRect(), visible = rail.getBoundingClientRect();
      const from = Math.max(0, Math.floor(visible.left - clip.left) - 3), to = Math.min(clip.width, Math.ceil(visible.right - clip.left) + 3);
      const width = Math.max(0, to - from), height = clip.height;
      const ratio = window.devicePixelRatio || 1;
      surface.style.left = `${from}px`; surface.style.width = `${width}px`; surface.style.height = `${height}px`;
      surface.width = Math.ceil(width * ratio); surface.height = Math.ceil(height * ratio);
      const context = surface.getContext('2d');
      if (!context || width <= 0 || height <= 0) return;
      context.scale(ratio, ratio); context.strokeStyle = '#ffffffb3'; context.lineWidth = 1;
      context.beginPath();
      for (const bar of waveformBars(data, timing.sourceStart, timing.duration, clip.width, from, to, gain === 0 ? 1 : gain)) {
        const half = bar.amplitude * (height / 2 - 1);
        if (half < .5) continue;
        const x = bar.left - from + .5;
        context.moveTo(x, height / 2 - half); context.lineTo(x, height / 2 + half);
      }
      context.stroke();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const trim = (event: Event) => { timing = (event as CustomEvent<typeof timing>).detail; schedule(); };
    const adjustVolume = (event: Event) => { gain = (event as CustomEvent<number>).detail; node.classList.toggle('is-muted', gain === 0); schedule(); };
    const resize = new ResizeObserver(schedule); resize.observe(node); resize.observe(rail);
    node.parentElement?.addEventListener('revline:clip-trim-preview', trim);
    node.parentElement?.addEventListener('revline:clip-volume-preview', adjustVolume);
    rail.addEventListener('scroll', schedule, { passive: true }); draw();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); rail.removeEventListener('scroll', schedule); node.parentElement?.removeEventListener('revline:clip-trim-preview', trim); node.parentElement?.removeEventListener('revline:clip-volume-preview', adjustVolume); };
  }, [data, sourceStart, duration, volume, muted, timelineStart, viewport]);
  return <>
    <div ref={root} className={`audio-waveform${muted ? ' is-muted' : ''}`} aria-hidden="true" data-waveform-ready={!!data}><canvas ref={canvas}/></div>
    {muted && <VolumeX className="audio-muted-icon" size={12} role="img" aria-label="Muted clip"><title>Muted clip</title></VolumeX>}
  </>;
});
