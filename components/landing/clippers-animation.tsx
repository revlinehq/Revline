'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { calculateVisualRect } from '@/lib/editor/visual-source-geometry';
import { motionAt } from '@/lib/editor/motion-path';
import { maskAt } from '@/lib/editor/masks';
import footage from './clippers-footage.json';
import { createClippersScene } from './clippers-scene';

const WIDTH = 1920,
  HEIGHT = 1080,
  DURATION = 11.4,
  STILL = 10.8;
type Playback = { setPlaying: (playing: boolean) => void };

export default function ClippersAnimation({ playing }: { playing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const playback = useRef<Playback | null>(null);
  const visible = useRef(playing);
  visible.current = playing;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    gsap.registerPlugin(CustomEase);
    const scene = document.createElement('div');
    scene.className = 'landing-clippers-scene';
    const canvas = document.createElement('canvas');
    scene.appendChild(canvas);
    const context = canvas.getContext('2d');
    if (!context) return;
    const timeline = gsap.timeline({ paused: true, id: 'landing-clippers' });
    createClippersScene(scene, timeline);
    const media = new Map<string, HTMLVideoElement>();
    const starting = new Set<HTMLVideoElement>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false,
      ready = false,
      running = false,
      frame = 0,
      time = 0,
      previous = 0;

    const draw = () => {
      // Keep the last complete frame during a seek, including across the loop seam.
      if (
        footage.some(
          (clip) =>
            time >= clip.start &&
            time < clip.start + clip.duration &&
            (media.get(clip.source)?.readyState ?? 0) < 2,
        )
      )
        return;
      timeline.totalTime(time, false);
      context.setTransform(
        canvas.width / WIDTH,
        0,
        0,
        canvas.height / HEIGHT,
        0,
        0,
      );
      context.fillStyle = '#111';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      for (const clip of footage) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const video = media.get(clip.source);
        if (!video || video.readyState < 2) continue;
        const local = time - clip.start;
        const motion = motionAt(clip.motion, local);
        const rect = calculateVisualRect(
          clip.width,
          clip.height,
          WIDTH,
          HEIGHT,
          clip.crop,
          undefined,
          'contain',
        );
        context.save();
        if (clip.mask) {
          const mask = maskAt(clip.mask.keys, local);
          context.beginPath();
          context.rect(
            (mask.x - mask.width / 2) * WIDTH,
            (mask.y - mask.height / 2) * HEIGHT,
            mask.width * WIDTH,
            mask.height * HEIGHT,
          );
          context.clip();
        }
        context.translate(
          WIDTH / 2 + motion.x * WIDTH,
          HEIGHT / 2 + motion.y * HEIGHT,
        );
        context.rotate((motion.rotation * Math.PI) / 180);
        context.scale(motion.scale, motion.scale);
        context.translate(-WIDTH / 2, -HEIGHT / 2);
        context.beginPath();
        context.rect(
          rect.window.left,
          rect.window.top,
          rect.window.width,
          rect.window.height,
        );
        context.clip();
        context.globalAlpha = motion.opacity;
        context.filter = `brightness(${motion.brightness})`;
        context.drawImage(video, rect.left, rect.top, rect.width, rect.height);
        context.restore();
      }
      if (!scene.isConnected) container.appendChild(scene);
    };

    // Cropped regions share one decoder and source clock per creator.
    const syncMedia = () => {
      for (const [source, video] of media) {
        const clip = footage.find(
          (clip) =>
            clip.source === source &&
            time >= clip.start &&
            time < clip.start + clip.duration,
        );
        if (!clip) {
          video.pause();
          const next = footage.find(
            (clip) =>
              clip.source === source &&
              clip.start > time &&
              clip.start - time < 0.5,
          );
          if (
            next &&
            !video.seeking &&
            Math.abs(video.currentTime - next.sourceStart) > 0.02
          )
            video.currentTime = next.sourceStart;
          continue;
        }
        const target = time - clip.start + clip.sourceStart;
        if (!video.seeking && Math.abs(video.currentTime - target) > 0.12)
          video.currentTime = target;
        if (running && video.paused && !starting.has(video)) {
          starting.add(video);
          void video
            .play()
            .catch(() => {})
            .finally(() => starting.delete(video));
        } else if (!running) video.pause();
      }
    };
    const tick = (now: number) => {
      if (!running) return;
      // Suspend the clock during an OS/browser stall instead of skipping a whole beat.
      time = (time + Math.min((now - previous) / 1000, 0.1)) % DURATION;
      previous = now;
      syncMedia();
      draw();
      frame = requestAnimationFrame(tick);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      running =
        ready && visible.current && !document.hidden && !reduced.matches;
      if (!ready) return;
      if (reduced.matches) time = STILL;
      syncMedia();
      draw();
      if (running) {
        previous = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    const resize = () => {
      const width = container.clientWidth;
      const pixels = Math.min(devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.round(width * pixels));
      canvas.height = Math.max(
        1,
        Math.round(((width * HEIGHT) / WIDTH) * pixels),
      );
      scene.style.transform = `scale(${width / WIDTH})`;
      if (ready) draw();
    };
    const size = new ResizeObserver(resize);
    size.observe(container);
    const loads = [...new Set(footage.map((clip) => clip.source))].map(
      (source) =>
        new Promise<void>((resolve, reject) => {
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.onloadeddata = () => resolve();
          video.onerror = () =>
            reject(new Error('Could not load clippers footage'));
          video.onseeked = () => {
            if (ready && !running) draw();
          };
          video.src = `/landing/clippers-${source}.mp4`;
          media.set(source, video);
        }),
    );
    loads.push(
      ...Array.from(scene.querySelectorAll('img'), (image) =>
        image.decode().catch(() => {}),
      ),
    );
    void Promise.all(loads)
      .then(() => {
        if (disposed) return;
        time = reduced.matches ? STILL : 0;
        ready = true;
        syncMedia();
        resize();
        update();
      })
      .catch(() => {
        /* The still remains visible if a media request fails. */
      });
    playback.current = { setPlaying: update };
    document.addEventListener('visibilitychange', update);
    reduced.addEventListener('change', update);
    return () => {
      disposed = true;
      running = false;
      playback.current = null;
      cancelAnimationFrame(frame);
      size.disconnect();
      document.removeEventListener('visibilitychange', update);
      reduced.removeEventListener('change', update);
      timeline.kill();
      for (const video of media.values()) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      scene.remove();
    };
  }, []);

  useEffect(() => {
    playback.current?.setPlaying(playing);
  }, [playing]);
  return (
    <div ref={host} className="landing-clippers-animation" aria-hidden="true" />
  );
}
