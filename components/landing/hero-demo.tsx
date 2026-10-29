'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { ClaudeLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { LandingInstallAgents } from './install-agents';

// The Blueprint launch film, made in Revline from screenshots. Swap the export in here.
const FILM_SRC = '/landing/blueprint-launch-final.mp4';
const FILM_POSTER = '/landing/blueprint-launch-final-poster.webp';
const FILM_SECONDS = 37.9;

// Beat starts in film seconds, from the Blueprint launch markers. The first seven are Revline's story, the rest T3 Code's film.
const BEATS: { at: number; label: string }[] = [
  { at: 0, label: 'Intro title' }, { at: 2.9, label: 'Composer' }, { at: 6.8, label: 'Chat' }, { at: 8.9, label: 'Screenshot parts' },
  { at: 12.5, label: 'Timeline edit' }, { at: 16.4, label: 'Reveal' }, { at: 18.5, label: 'Meet T3 Code' }, { at: 19, label: 'First ADE' },
  { at: 21.37, label: 'Composer' }, { at: 23.87, label: 'Chat' }, { at: 26.67, label: 'Threads' }, { at: 29.77, label: 'Code view' },
  { at: 31.3, label: 'Browser' }, { at: 32.87, label: 'Free / Open source' }, { at: 35.6, label: 'Made for everyone' },
];
const T3_FROM = 6;

// Screenshots of Revline working inside each app. Until they exist (src null) the panel shows a quiet stand-in.
// Wanted: public/landing/agents/claude.webp and public/landing/agents/chatgpt.webp, 16:9, about 2560x1440.
const AGENT_SHOTS = {
  claude: { name: 'Claude', Logo: ClaudeLogo, src: null as string | null, prompt: 'Turn these screenshots into a 30 second launch film.' },
  chatgpt: { name: 'ChatGPT', Logo: OpenAILogo, src: null as string | null, prompt: 'Cut the pauses and add captions to my podcast clip.' },
};

type View = 'revline' | keyof typeof AGENT_SHOTS;
const VIEWS: { id: View; label: string }[] = [{ id: 'revline', label: 'Revline' }, { id: 'claude', label: 'Claude' }, { id: 'chatgpt', label: 'ChatGPT' }];

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const beatAt = (time: number) => BEATS.findLastIndex(beat => beat.at <= time + 0.01);

/** The film plus its own beat timeline: segments fill as it plays, and clicking one seeks to that beat. */
function FilmTimeline({ video, active }: { video: React.RefObject<HTMLVideoElement | null>; active: boolean }) {
  const segments = useRef<(HTMLButtonElement | null)[]>([]);
  const [duration, setDuration] = useState(FILM_SECONDS);
  const [beat, setBeat] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let frame = 0;
    const paint = () => {
      const now = element.currentTime;
      BEATS.forEach((item, index) => {
        const end = BEATS[index + 1]?.at ?? duration;
        segments.current[index]?.style.setProperty('--fill', String(Math.min(1, Math.max(0, (now - item.at) / (end - item.at)))));
      });
      setBeat(beatAt(now));
      setTime(Math.floor(now));
      if (!element.paused) frame = requestAnimationFrame(paint);
    };
    const sync = () => { setPlaying(!element.paused); setMuted(element.muted); cancelAnimationFrame(frame); paint(); };
    // Never shorter than the last beat, so every segment keeps a positive length.
    const meta = () => { if (Number.isFinite(element.duration)) setDuration(Math.max(element.duration, BEATS[BEATS.length - 1].at + 1)); };
    meta(); sync();
    const events = ['play', 'pause', 'seeked', 'volumechange', 'timeupdate'] as const;
    events.forEach(name => element.addEventListener(name, sync));
    element.addEventListener('loadedmetadata', meta);
    return () => { cancelAnimationFrame(frame); events.forEach(name => element.removeEventListener(name, sync)); element.removeEventListener('loadedmetadata', meta); };
  }, [video, duration]);

  function seek(index: number) {
    const element = video.current;
    if (!element) return;
    element.currentTime = BEATS[index].at;
    void element.play().catch(() => {});
  }
  function toggle() {
    const element = video.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => {}); else element.pause();
  }

  return <div className="landing-film-timeline" data-active={active || undefined} aria-hidden={!active} inert={!active}>
    <div className="landing-film-meta">
      <button type="button" className="landing-film-icon" onClick={toggle} aria-label={playing ? 'Pause film' : 'Play film'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
      <span className="landing-film-beat" aria-live="polite">{BEATS[beat]?.label}</span>
      <span className="landing-film-act">{beat >= T3_FROM ? 'T3 Code' : 'Revline'}</span>
      <span className="landing-film-clock">{clock(time)} / {clock(duration)}</span>
      <button type="button" className="landing-film-icon" onClick={() => { if (video.current) video.current.muted = !video.current.muted; }} aria-label={muted ? 'Turn sound on' : 'Mute'}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
    </div>
    <div className="landing-film-beats">
      {BEATS.map((item, index) => {
        const length = (BEATS[index + 1]?.at ?? duration) - item.at;
        return <button key={index} ref={node => { segments.current[index] = node; }} type="button" style={{ flexGrow: length } as CSSProperties}
          data-label={item.label} data-current={index === beat || undefined} data-act={index >= T3_FROM ? 't3' : 'revline'}
          aria-label={`${item.label}, ${clock(item.at)}`} onClick={() => seek(index)}><i /></button>;
      })}
    </div>
  </div>;
}

function AgentShot({ id, active }: { id: keyof typeof AGENT_SHOTS; active: boolean }) {
  const { name, Logo, src, prompt } = AGENT_SHOTS[id];
  if (src) return <img className="landing-demo-shot" src={src} alt={`Revline editing a video inside ${name}`} loading="lazy" decoding="async" />;
  return <div className="landing-demo-standin" inert={!active}>
    <Logo width={28} height={28} aria-hidden="true" />
    <p className="landing-demo-standin-prompt">{prompt}</p>
    <p className="landing-demo-standin-note">Revline edits the video while you talk to {name}.</p>
  </div>;
}

/** Hero demo: the launch film with its beat timeline, and Revline seen from inside Claude and ChatGPT. */
export function LandingHeroDemo() {
  const video = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState<View>('revline');
  const visible = useRef(false);

  // Plays only while it is on screen and selected; reduced motion waits for the play button.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (!entry.isIntersecting) element.pause();
      else if (!calm && view === 'revline') void element.play().catch(() => {});
    }, { threshold: 0.25 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [view]);

  // The hosted assets answer without byte ranges, so a streamed film can't seek past what it has buffered.
  // Once it first plays, fetch the whole file and continue from an in-memory copy, which seeks anywhere.
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let url = '';
    const controller = new AbortController();
    const load = () => {
      element.removeEventListener('play', load);
      void fetch(FILM_SRC, { signal: controller.signal }).then(response => response.ok ? response.blob() : null).then(blob => {
        if (!blob) return;
        url = URL.createObjectURL(blob);
        const at = element.currentTime, playing = !element.paused;
        element.src = url;
        element.currentTime = at;
        if (playing) void element.play().catch(() => {});
      }).catch(() => {});
    };
    element.addEventListener('play', load);
    return () => { element.removeEventListener('play', load); controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, []);

  function pick(next: View) {
    setView(next);
    const element = video.current;
    if (!element) return;
    if (next !== 'revline') element.pause();
    else if (visible.current) void element.play().catch(() => {});
  }

  const index = VIEWS.findIndex(item => item.id === view);
  return <div className="landing-demo">
    <div className="landing-product-frame">
      <div className="landing-demo-window">
        <div className="landing-demo-stage">
          <div className="landing-demo-panel" data-active={view === 'revline' || undefined}>
            <video ref={video} className="landing-demo-film" src={FILM_SRC} poster={FILM_POSTER} muted loop playsInline preload="metadata" aria-label="Revline's launch film for T3 Code, made from screenshots" />
          </div>
          {(Object.keys(AGENT_SHOTS) as (keyof typeof AGENT_SHOTS)[]).map(id => <div key={id} className="landing-demo-panel" data-active={view === id || undefined}><AgentShot id={id} active={view === id} /></div>)}
        </div>
        <div className="landing-demo-bar">
          <FilmTimeline video={video} active={view === 'revline'} />
          {(Object.keys(AGENT_SHOTS) as (keyof typeof AGENT_SHOTS)[]).map(id => <div key={id} className="landing-demo-caption" data-active={view === id || undefined} aria-hidden={view !== id} inert={view !== id}>
            <span>Revline inside {AGENT_SHOTS[id].name}</span>
            <LandingInstallAgents variant="neutral" size="sm" initial={id} label={`Install on ${AGENT_SHOTS[id].name}`} />
          </div>)}
        </div>
      </div>
    </div>
    <div className="landing-demo-switch" role="tablist" aria-label="Where Revline runs" style={{ '--switch-index': index } as CSSProperties}>
      <span className="landing-demo-switch-pill" aria-hidden="true" />
      {VIEWS.map(item => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => pick(item.id)}>{item.label}</button>)}
    </div>
  </div>;
}
