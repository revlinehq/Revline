'use client';

import { useEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { createClippersScene } from './clippers-scene';

const WIDTH = 1920,
  HEIGHT = 1080,
  DURATION = 11.4,
  STILL = 10.8;
type Playback = { setPlaying: (playing: boolean) => void };
type PortraitClip = {
  source: string;
  card: 0 | 1 | 2 | 3 | 4 | 5;
  start: number;
  duration: number;
  sourceStart: number;
};
const portraits: PortraitClip[] = [
  { source: 'theo', card: 0, start: 1.65, duration: 9.75, sourceStart: 1.65 },
  { source: 'lex', card: 1, start: 3.65, duration: 7.75, sourceStart: 0 },
  { source: 'acquired', card: 2, start: 4.7, duration: 6.7, sourceStart: 0 },
  { source: 'allin', card: 3, start: 6.8, duration: 4.6, sourceStart: 0 },
  { source: 'dwarkesh', card: 4, start: 6.95, duration: 4.45, sourceStart: 0 },
  { source: 'lenny', card: 5, start: 7.1, duration: 4.3, sourceStart: 0 },
  {
    source: 'lex',
    card: 0,
    start: 1.666666667,
    duration: 0.65,
    sourceStart: 0,
  },
  {
    source: 'dwarkesh',
    card: 0,
    start: 2.316666667,
    duration: 0.65,
    sourceStart: 0,
  },
];
const intro = {
  source: 'theo-source',
  start: 0,
  duration: 1.65,
  sourceStart: 0,
};
const clocks = [intro, ...portraits];

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
    const { openings } = createClippersScene(scene, timeline);
    const media = new Map<string, HTMLVideoElement>();
    const starting = new Set<HTMLVideoElement>();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false,
      ready = false,
      running = false,
      frame = 0,
      time = 0,
      previous = 0;

    const drawCard = (
      video: HTMLVideoElement,
      opening: (typeof openings)[number],
    ) => {
      const scale = Math.max(
        opening.width / video.videoWidth,
        opening.height / video.videoHeight,
      );
      const width = video.videoWidth * scale;
      const height = video.videoHeight * scale;
      context.save();
      context.beginPath();
      context.rect(
        opening.x - opening.width / 2,
        opening.y - opening.height / 2,
        opening.width,
        opening.height,
      );
      context.clip();
      context.drawImage(
        video,
        opening.x - width / 2,
        opening.y - height / 2,
        width,
        height,
      );
      context.restore();
    };

    const draw = () => {
      // Keep the last complete frame during a seek, including across the loop seam.
      if (
        clocks.some(
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
      const source = media.get(intro.source);
      if (time < intro.duration && source && source.readyState >= 2)
        drawCard(source, openings[0]);
      for (const clip of portraits) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const video = media.get(clip.source);
        if (video && video.readyState >= 2)
          drawCard(video, openings[clip.card]);
      }
      if (!scene.isConnected) container.appendChild(scene);
    };

    // Cropped regions share one decoder and source clock per creator.
    const syncMedia = () => {
      for (const [source, video] of media) {
        const clip = clocks.find(
          (clip) =>
            clip.source === source &&
            time >= clip.start &&
            time < clip.start + clip.duration,
        );
        if (!clip) {
          video.pause();
          const next = clocks.find(
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
        const target = (time - clip.start + clip.sourceStart) % video.duration;
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
    const loads = [...new Set(clocks.map((clip) => clip.source))].map(
      (source) =>
        new Promise<void>((resolve, reject) => {
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.loop = true;
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
