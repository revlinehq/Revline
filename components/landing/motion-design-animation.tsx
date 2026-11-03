'use client';

import { useEffect, useRef } from 'react';
import { clipColor } from '@/lib/editor/types';
import { createEditor } from './editor-illustration';
import { icon, part } from './clippers-dom';
import { createLandingVideoPlayback } from './video-playback';

// Seconds measured from the 60fps film, checked against full-resolution frames.
const scenes = [
  [0, 'Anyone', 'Opening type'],
  [0.55, 'Generate an image', 'TV collage'],
  [2.2667, 'Stand out', 'Red card'],
  [3.4, 'Generating', 'Retro computer'],
  [5.1, 'Image created', 'Floating images'],
  [6.5667, 'Download', 'Download button'],
  [9.1, 'Instinct · Timing · Feeling', 'Chess study'],
  [11.95, 'Break the pattern', 'Broken pawn'],
  [13.8667, 'Stay irreplaceable', 'Trophy'],
] as const;
const DURATION = 16.1;

/** Passive editor artwork, sharing the clipping film's shell and media lifecycle. */
export default function MotionDesignAnimation({ playing }: { playing: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const updatePlayback = useRef<((playing: boolean) => void) | null>(null);
  const visible = useRef(playing);
  visible.current = playing;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const scene = document.createElement('div');
    scene.className = 'landing-clippers-scene landing-motion-scene';
    const ui = createEditor(scene);
    const get = (name: string) => part(ui, name);
    get('project-title').textContent = 'Motion study';
    get('tab').textContent = 'Motion study  ·  0:16';
    const message = document.createElement('div');
    message.className = 'motion-editor-message';
    message.innerHTML = '<p>Make a motion film that feels impossible to scroll past.</p><p>9 scenes. Kinetic type, image collages and a chess study.</p><span>✓ Film ready · 9:16</span>';
    get('sidebar').appendChild(message);
    const video = document.createElement('video');
    video.className = 'motion-editor-video';
    video.loop = true;
    video.preload = 'none';
    video.poster = '/landing/motion-design-study-poster.webp';
    const playback = createLandingVideoPlayback(video, reason => {
      video.controls = reason !== null || reduced.matches;
    });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    video.src = '/landing/motion-design-study.mp4';
    get('video-frame').appendChild(video);
    const transport = get('transport');
    transport.innerHTML = `${icon('play', { size: 20 })}<span class="motion-editor-time">00:00 / 00:16</span>`;
    const time = transport.querySelector('span')!;
    const timeline = get('timeline');
    timeline.className = 'motion-editor-timeline';
    const ruler = document.createElement('div');
    ruler.className = 'motion-editor-ruler';
    timeline.appendChild(ruler);
    const tracks = document.createElement('div');
    tracks.className = 'motion-editor-tracks';
    timeline.appendChild(tracks);
    for (const label of ['Scenes', 'Graphics', 'Music']) {
      const row = document.createElement('div');
      row.className = 'motion-editor-row';
      row.innerHTML = `<span class="motion-track-name">${label}</span>`;
      tracks.appendChild(row);
    }
    const rows = Array.from(tracks.children) as HTMLElement[];
    const clips: { node: HTMLElement; start: number; end: number }[] = [];
    const addClip = (row: number, start: number, end: number, label: string, identity: string) => {
      const node = document.createElement('div');
      node.className = `motion-timeline-clip motion-clip-${identity}`;
      node.style.left = `${start / DURATION * 100}%`;
      node.style.width = `${(end - start) / DURATION * 100}%`;
      node.style.setProperty('--track-color', clipColor(row === 0 ? 'scene' : row === 1 ? 'graphic' : 'audio'));
      node.innerHTML = `<span class="motion-clip-label"><b>${row === 0 ? '{}' : row === 1 ? 'T' : '♪'}</b><span>${label}</span></span>`;
      rows[row].appendChild(node);
      clips.push({ node, start, end });
      return node;
    };
    scenes.forEach(([start, text, title], index) => {
      const end = scenes[index + 1]?.[0] ?? DURATION;
      const node = addClip(0, start, end, title, 'scene');
      const image = document.createElement('div');
      image.className = 'motion-clip-filmstrip';
      image.style.backgroundImage = `url(/landing/motion-scene-${index}.webp)`;
      node.appendChild(image);
      const graphic = addClip(1, start, end, text, 'text');
      graphic.insertAdjacentHTML('beforeend', `<span class="motion-clip-specimen">Aa <span>${text}</span></span>`);
    });
    // The showcase MP4 is silent; this is an illustrative music-bed track.
    const music = addClip(2, 0, DURATION, 'Music bed', 'music');
    music.insertAdjacentHTML('beforeend', `<div class="motion-waveform">${Array.from({ length: 220 }, (_, i) => {
      const amplitude = 8 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * .19)) * 29;
      return `<i style="height:${amplitude}px"></i>`;
    }).join('')}</div>`);
    const head = document.createElement('div');
    head.className = 'motion-editor-playhead';
    timeline.appendChild(head);
    let frame = 0;
    const draw = () => {
      const current = video.currentTime;
      head.style.left = `calc(100px + (100% - 116px) * ${Math.min(current / DURATION, 1)})`;
      time.textContent = `00:${String(Math.floor(current)).padStart(2, '0')} / 00:16`;
      for (const clip of clips) clip.node.dataset.active = String(current >= clip.start && current < clip.end);
    };
    const tick = () => {
      draw();
      if (!video.paused) frame = requestAnimationFrame(tick);
    };
    const onPlay = () => { cancelAnimationFrame(frame); tick(); };
    video.addEventListener('play', onPlay);
    video.addEventListener('timeupdate', draw);
    video.addEventListener('seeked', draw);
    const update = () => {
      video.controls = reduced.matches || video.dataset.playback === 'blocked' || video.dataset.playback === 'error';
      playback.setPlaying(visible.current && !reduced.matches);
      if (!visible.current) cancelAnimationFrame(frame);
    };
    updatePlayback.current = update;
    reduced.addEventListener('change', update);
    const resize = () => {
      const phone = container.clientWidth < 500;
      const width = phone ? 1000 : 1920;
      const height = phone ? 1150 : 1080;
      scene.style.width = `${width}px`;
      scene.style.height = `${height}px`;
      scene.style.transform = `scale(${container.clientWidth / width})`;
      scene.dataset.phone = String(phone);
      ruler.innerHTML = Array.from({ length: 9 }, (_, i) => `<span style="left:${i * 2 / DURATION * 100}%">${i * 2}s</span>`).join('');
      draw();
    };
    container.appendChild(scene);
    const size = new ResizeObserver(resize);
    size.observe(container);
    resize();
    update();
    return () => {
      updatePlayback.current = null;
      cancelAnimationFrame(frame);
      size.disconnect();
      reduced.removeEventListener('change', update);
      playback.dispose();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('timeupdate', draw);
      video.removeEventListener('seeked', draw);
      video.removeAttribute('src');
      video.load();
      scene.remove();
    };
  }, []);

  useEffect(() => { updatePlayback.current?.(playing); }, [playing]);
  return <div ref={host} className="landing-motion-animation" aria-hidden="true" />;
}
