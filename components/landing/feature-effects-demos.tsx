'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { RemotionTransitionPresentation } from '@/lib/editor/remotion-transition-presentation';
import { motionAt, NEUTRAL_MOTION } from '@/lib/editor/clip-effects';
import { flashKeyframes, punchKeyframes, shakeKeyframes } from '@/lib/editor/motion-effect-settings';
import type { TransitionPreset } from '@/lib/editor/clip-transitions';
import { FEATURE_MEDIA } from './features-media-config';
import './feature-effects-demos.css';

type Kind = 'transitions' | 'effects';
const presets = ['crossfade', 'spin-zoom', 'blur-dissolve'] as const;
const names = { crossfade: 'Crossfade', 'spin-zoom': 'Spin zoom', 'blur-dissolve': 'Blur dissolve' };
const cuts = [
  { time: 4.8, before: '/demo/landing/transition-1-out.webp', after: '/demo/landing/transition-1-in.webp' },
  { time: 7.7, before: '/demo/landing/transition-2-out.webp', after: '/demo/landing/transition-2-in.webp' },
];
// These are the product's own preset curves, sampled by the native media clock.
const accents = [
  { id: 'punch', label: 'Push-in', start: 5.45, duration: 1.25, keys: punchKeyframes(1.25, { amount: 1.14, speed: 1, centerX: .5, centerY: .3, attack: .35, release: .9 }) },
  { id: 'shake', label: 'Shake', start: 5.65, duration: .4, keys: shakeKeyframes(.4, { strength: .18, speed: .85, direction: 'both' }) },
  { id: 'flash', label: 'Flash', start: 5.74, duration: .22, keys: flashKeyframes(.22, { strength: .06, attack: .25, release: .75 }) },
] as const;
type Presentation = { cut: number; progress: number; preset: typeof presets[number] };

/** One decoder; genuine product transition presentations and motion curves over NASA footage. */
export function AdditionalFeatureDemo({ kind }: { kind: Kind }) {
  const media = FEATURE_MEDIA[kind], video = useRef<HTMLVideoElement>(null), surface = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLDivElement | null)[]>([]), loop = useRef(0), lastWindow = useRef(-1), lastAccents = useRef('');
  const [playing, setPlaying] = useState(true), [presentation, setPresentation] = useState<Presentation | null>(null);
  const [selectedPreset, setPreset] = useState<TransitionPreset>('crossfade'), [activeAccents, setAccents] = useState<string[]>([]);

  useEffect(() => {
    if (kind !== 'transitions') return;
    // Decode the four small, exact cut-edge frames before the first presentation.
    const frames = cuts.flatMap(cut => [cut.before, cut.after]).map(src => { const image = new Image(); image.src = src; void image.decode().catch(() => {}); return image; });
    return () => frames.forEach(image => image.removeAttribute('src'));
  }, [kind]);

  const paint = useCallback((time: number) => {
    if (surface.current) surface.current.dataset.mediaTime = time.toFixed(3);
    if (kind === 'transitions') {
      const index = cuts.findIndex(cut => time >= cut.time - .3 && time < cut.time + .3);
      if (index >= 0) {
        const preset = presets[(index + loop.current) % presets.length];
        setPresentation({ cut: index, preset, progress: (time - cuts[index].time + .3) / .6 });
        if (lastWindow.current !== index) setPreset(preset);
      } else if (lastWindow.current >= 0) setPresentation(null);
      lastWindow.current = index;
      return;
    }
    const active: string[] = [];
    accents.forEach((accent, index) => {
      const local = time - accent.start, enabled = local >= 0 && local < accent.duration;
      const motion = enabled ? motionAt(accent.keys, local) : NEUTRAL_MOTION;
      const layer = layers.current[index];
      if (layer) {
        layer.style.transform = `translate(${motion.x * 100}%,${motion.y * 100}%) rotate(${motion.rotation}deg) scale(${motion.scale})`;
        layer.style.opacity = String(motion.opacity);
        layer.style.filter = `brightness(${motion.brightness})`;
      }
      if (enabled) active.push(accent.id);
    });
    const signature = active.join(',');
    if (signature !== lastAccents.current) { lastAccents.current = signature; setAccents(active); }
  }, [kind]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let disposed = false, callback: number | undefined, animation = 0;
    const cancel = () => {
      if (callback !== undefined) element.cancelVideoFrameCallback(callback);
      callback = undefined; cancelAnimationFrame(animation); animation = 0;
    };
    const update = () => {
      if (element.currentTime >= media.end - .035 || element.currentTime < media.start - .035) {
        if (element.currentTime >= media.end - .035) loop.current++;
        element.currentTime = media.start;
        if (element.paused && playing && !document.hidden) playback();
      }
      paint(element.currentTime);
    };
    const frame = () => {
      callback = undefined; animation = 0;
      if (disposed || !playing || document.hidden || element.paused) return;
      update();
      schedule();
    };
    const schedule = () => {
      if (disposed || !playing || document.hidden || element.paused || callback !== undefined || animation) return;
      if (element.requestVideoFrameCallback) callback = element.requestVideoFrameCallback(frame);
      else animation = requestAnimationFrame(frame);
    };
    const playback = () => {
      cancel();
      if (!playing || document.hidden) { element.pause(); return; }
      void element.play().then(() => {
        if (disposed || !playing || document.hidden) return;
        schedule();
      }).catch(() => { if (!disposed && !document.hidden) setPlaying(false); });
    };
    const loaded = () => { update(); playback(); };
    const ended = () => { loop.current++; element.currentTime = media.start; paint(media.start); playback(); };
    element.addEventListener('loadedmetadata', loaded);
    element.addEventListener('timeupdate', update);
    element.addEventListener('ended', ended);
    document.addEventListener('visibilitychange', playback);
    if (element.readyState >= 1) loaded();
    return () => {
      disposed = true; cancel(); element.pause();
      element.removeEventListener('loadedmetadata', loaded); element.removeEventListener('timeupdate', update);
      element.removeEventListener('ended', ended);
      document.removeEventListener('visibilitychange', playback);
    };
  }, [media, paint, playing]);

  const footage = <video ref={video} src={media.src} poster={media.poster} autoPlay muted playsInline preload="metadata" width={960} height={540} aria-label={kind === 'transitions' ? 'NASA footage with real transition presentations' : 'NASA liftoff with a timed push-in, shake and flash'}/>;
  return <div ref={surface} className={`feature-demo feature-demo-${kind}`} data-feature-media={kind} data-playing={playing}>
    <div className="feature-demo-footage">{kind === 'effects' ? <div className="feature-impact-layer" ref={node => { layers.current[2] = node; }} data-effect-preset="flash"><div className="feature-impact-layer" ref={node => { layers.current[1] = node; }} data-effect-preset="shake"><div className="feature-impact-layer" ref={node => { layers.current[0] = node; }} data-effect-preset="punch">{footage}</div></div></div> : footage}</div>
    {kind === 'transitions' && presentation ? <div className="feature-transition-surface" aria-hidden="true"><RemotionTransitionPresentation preset={presentation.preset} direction="clockwise" progress={presentation.progress} durationInFrames={18} outputHeight={540} from={<img src={cuts[presentation.cut].before} alt="" width={960} height={540}/>} to={<img src={cuts[presentation.cut].after} alt="" width={960} height={540}/>}/></div> : null}
    <span className="feature-demo-label">{kind === 'transitions' ? 'The same cut. A different feeling.' : 'The launch drives the effect.'}</span>
    <div className="feature-effects-presets" aria-hidden="true">{kind === 'transitions' ? presets.map(preset => <span key={preset} data-active={selectedPreset === preset}>{names[preset]}</span>) : accents.map(accent => <span key={accent.id} data-active={activeAccents.includes(accent.id)}>{accent.label}<i/></span>)}</div>
    <a className="feature-demo-credit" href="https://svs.gsfc.nasa.gov/31385/" target="_blank" rel="noreferrer noopener">Footage: NASA</a>
    <button type="button" className="feature-demo-play" aria-label={playing ? 'Pause feature preview' : 'Play feature preview'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={14} fill="currentColor"/> : <Play size={14} fill="currentColor"/>}</button>
  </div>;
}
