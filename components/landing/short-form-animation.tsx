'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import sourceConfig from '@/public/landing/short-form-sources.json';
import { createLandingVideoPlayback } from './video-playback';

const sources: Omit<typeof sourceConfig, 'retainedRanges' | 'previewWords'> & {
  retainedRanges: { sourceStart: number; sourceEnd: number }[];
  previewWords: { text: string; start: number; end: number }[];
} = sourceConfig;

/** The edit ranges and caption markers come from the saved development Reel. */
export default function ShortFormAnimation({ playing }: { playing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const update = useRef<(() => void) | null>(null);
  const visible = useRef(playing);
  visible.current = playing;

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const scene = document.createElement('div');
    scene.className = 'short-form-scene';
    scene.style.visibility = 'hidden';
    // Passive artwork, following the neighboring editor illustrations.
    scene.innerHTML = `<div class="sf-header"><b>revline</b><span>Talking head → Reel</span><span class="sf-format">9:16</span></div>
      <div class="sf-notes"><span class="sf-eyebrow">SHORT-FORM EDIT</span><h3>A sharper take.</h3><p data-step>Drop in your footage</p><div class="sf-source"><span>▤</span><div><span data-source-name></span><small>${Math.round(sources.sourceDuration)} s · Original footage</small></div></div><div class="sf-summary"><span>✓ Tighten the pauses</span><span>✓ Caption every word</span><span>✓ Bring key lines closer</span></div></div>
      <div class="sf-stage"><div class="sf-phone"><video data-raw muted playsinline preload="auto" poster="${sources.rawPoster}"></video><video data-after muted playsinline preload="auto" poster="${sources.previewPoster}"></video></div><span class="sf-ready">✓ Ready to post</span></div>
      <div class="sf-timeline"><div class="sf-track-heading"><span data-time>Original · ${Math.round(sources.sourceDuration)} s</span><span>Video / Captions</span></div><div class="sf-ruler"><span>0:00</span><span>0:15</span><span>0:30</span><span>0:45</span><span>1:00</span></div><div class="sf-video-track"></div><div class="sf-caption-track"></div><i class="sf-playhead"></i></div>`;
    scene.querySelector('[data-source-name]')!.textContent = sources.fileName;
    const track = scene.querySelector<HTMLElement>('.sf-video-track')!;
    const captionTrack = scene.querySelector<HTMLElement>('.sf-caption-track')!;
    const cuts = sources.retainedRanges.map((range) => {
      const node = document.createElement('div');
      node.className = 'sf-retained';
      node.style.left = `${range.sourceStart / sources.sourceDuration * 100}%`;
      node.style.width = `${(range.sourceEnd - range.sourceStart) / sources.sourceDuration * 100}%`;
      node.style.backgroundImage = `url(${sources.rawPoster})`;
      track.appendChild(node);
      return node;
    });
    let cursor = 0;
    for (const range of sources.retainedRanges) {
      if (range.sourceStart > cursor) {
        const gap = document.createElement('div');
        gap.className = 'sf-removed';
        gap.style.left = `${cursor / sources.sourceDuration * 100}%`;
        gap.style.width = `${(range.sourceStart - cursor) / sources.sourceDuration * 100}%`;
        track.appendChild(gap);
      }
      cursor = range.sourceEnd;
    }
    if (cursor < sources.sourceDuration) {
      const gap = document.createElement('div');
      gap.className = 'sf-removed';
      gap.style.left = `${cursor / sources.sourceDuration * 100}%`;
      gap.style.width = `${(sources.sourceDuration - cursor) / sources.sourceDuration * 100}%`;
      track.appendChild(gap);
    }
    const words = sources.previewWords.filter(word => word.start < sources.previewStart + 4.75);
    const captionNodes = words.map((word) => {
      const node = document.createElement('span');
      node.textContent = word.text;
      captionTrack.appendChild(node);
      return node;
    });
    root.appendChild(scene);
    const raw = scene.querySelector<HTMLVideoElement>('[data-raw]')!;
    const after = scene.querySelector<HTMLVideoElement>('[data-after]')!;
    raw.src = sources.rawPreview;
    after.src = sources.preview;
    const rawPlayer = createLandingVideoPlayback(raw, () => update.current?.());
    const afterPlayer = createLandingVideoPlayback(after, () => update.current?.());
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const phone = scene.querySelector<HTMLElement>('.sf-phone')!;
    const step = scene.querySelector<HTMLElement>('[data-step]')!;
    const clock = scene.querySelector<HTMLElement>('[data-time]')!;
    const head = scene.querySelector<HTMLElement>('.sf-playhead')!;
    const ruler = [...scene.querySelectorAll('.sf-ruler span')];
    const film = gsap.timeline({ paused: true, repeat: -1, repeatDelay: .25 });
    film.fromTo(scene.querySelector('.sf-source'), { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: .6 }, 0)
      .fromTo(track, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: .6 }, .35)
      .to(scene.querySelectorAll('.sf-removed'), { opacity: 0, scaleX: 0, duration: .45, stagger: .025 }, 1.2);
    let output = 0;
    sources.retainedRanges.forEach((range, i) => {
      film.to(cuts[i], { left: `${output / sources.outputDuration * 100}%`, width: `${(range.sourceEnd - range.sourceStart) / sources.outputDuration * 100}%`, duration: .7, ease: 'power2.inOut' }, 1.65);
      output += range.sourceEnd - range.sourceStart;
    });
    film.to(raw, { opacity: 0, duration: .35 }, 2.25)
      .fromTo(after, { opacity: 0 }, { opacity: 1, duration: .35 }, 2.25)
      .to(phone, { borderRadius: 24, borderColor: '#555', boxShadow: '0 20px 60px #0008', duration: .6 }, 4.9)
      .to(scene.querySelector('.sf-ready'), { opacity: 1, y: 0, duration: .4 }, 5.2)
      .to({}, { duration: 1.65 }, 5.6)
      .to(scene, { opacity: 0, duration: .25 }, 7.25);
    words.forEach((word, i) => {
      film.fromTo(captionNodes[i], { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .15 }, 2.25 + word.start - sources.previewStart);
    });
    let raf = 0;
    let lastCycle = -1;
    let elapsed = 0;
    let previous = 0;
    const draw = () => {
      const now = performance.now();
      elapsed += (now - previous) / 1000;
      previous = now;
      film.totalTime(elapsed);
      const t = film.time();
      const cycle = film.iteration();
      if (cycle !== lastCycle) { raw.currentTime = 0; after.currentTime = 0; lastCycle = cycle; }
      rawPlayer.setPlaying(visible.current && t < 2.5);
      afterPlayer.setPlaying(visible.current && t >= 2.25);
      step.textContent = t < 1.2 ? 'Drop in your footage' : t < 2.5 ? 'Cut pauses. Keep the thought.' : t < 4.9 ? 'Captions, timed to your words.' : 'Your Reel, ready to share.';
      clock.textContent = t < 2.3 ? `Original · ${Math.round(sources.sourceDuration)} s` : `Reel · ${Math.round(sources.outputDuration)} s`;
      const edited = t >= 2.3;
      const duration = edited ? sources.outputDuration : sources.sourceDuration;
      const position = edited ? sources.previewStart + after.currentTime : raw.currentTime;
      head.style.left = `${Math.min(position / duration, 1) * 100}%`;
      ruler.forEach((label, i) => {
        const seconds = Math.round(i / (ruler.length - 1) * duration);
        label.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      });
      if (visible.current && !reduced.matches && !document.hidden) raf = requestAnimationFrame(draw);
    };
    let mediaReady = false;
    const sync = () => {
      cancelAnimationFrame(raf);
      mediaReady ||= raw.readyState >= 2 && after.readyState >= 2;
      const ready = mediaReady && ![raw, after].some(video => ['blocked', 'error'].includes(video.dataset.playback ?? ''));
      if (visible.current && !reduced.matches && !document.hidden && ready) { previous = performance.now(); draw(); }
      else { film.pause(); rawPlayer.setPlaying(false); afterPlayer.setPlaying(false); }
      scene.style.visibility = reduced.matches || !ready ? 'hidden' : 'visible';
    };
    update.current = sync;
    raw.addEventListener('loadeddata', sync);
    after.addEventListener('loadeddata', sync);
    reduced.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    const resize = new ResizeObserver(() => { scene.style.transform = `scale(${root.clientWidth / 1000})`; });
    resize.observe(root);
    sync();
    return () => {
      raw.removeEventListener('loadeddata', sync); after.removeEventListener('loadeddata', sync);
      update.current = null; cancelAnimationFrame(raf); film.kill(); resize.disconnect();
      document.removeEventListener('visibilitychange', sync);
      reduced.removeEventListener('change', sync); rawPlayer.dispose(); afterPlayer.dispose();
      for (const video of [raw, after]) { video.removeAttribute('src'); video.load(); }
      scene.remove();
    };
  }, []);

  useEffect(() => { update.current?.(); }, [playing]);
  return <div ref={host} className="landing-short-form-animation" aria-hidden="true" />;
}
