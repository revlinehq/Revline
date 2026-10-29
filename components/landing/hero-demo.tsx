'use client';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Check, Clapperboard, Music, Pause, Play, Plus, Volume2, VolumeX } from 'lucide-react';
import { Brand } from '@/components/workspace/brand';
import { ClaudeLogo, OpenAILogo } from '@/components/workspace/ai-app-logos';
import { LandingInstallAgents } from './install-agents';

// The Blueprint launch film, made in Revline from screenshots. Swap the export in here.
const FILM_SRC = '/landing/blueprint-launch-final.mp4';
const FILM_POSTER = '/landing/blueprint-launch-final-poster.webp';
const FILM_SECONDS = 37.92;

// Beat starts in film seconds, from the Blueprint launch markers. From "Meet T3 Code" on it is T3 Code's own film.
const BEATS: { at: number; label: string }[] = [
  { at: 0, label: 'Intro title' }, { at: 2.9, label: 'Composer' }, { at: 6.8, label: 'Chat' }, { at: 8.9, label: 'Screenshot parts' },
  { at: 12.5, label: 'Timeline edit' }, { at: 16.4, label: 'Reveal' }, { at: 18.5, label: 'Meet T3 Code' }, { at: 19, label: 'First ADE' },
  { at: 21.37, label: 'Composer' }, { at: 23.87, label: 'Chat' }, { at: 26.67, label: 'Threads' }, { at: 29.77, label: 'Code view' },
  { at: 31.3, label: 'Browser' }, { at: 32.87, label: 'Free / Open source' }, { at: 35.6, label: 'Made for everyone' },
];
// The half-second "Meet T3 Code" title shares a clip with "First ADE", so the timeline holds the 14 clips the chat mentions.
const CLIPS = BEATS.filter(beat => beat.label !== 'First ADE').map((beat, index, list) => ({ ...beat, end: list[index + 1]?.at ?? FILM_SECONDS }));
const T3_FROM = 18.5;

// The chat that made the film: the user's two screenshots and prompt, then the agent's work.
const SCREENSHOTS = [
  { src: '/landing/editor/screenshot-threads.webp', alt: 'T3 Code screenshot: threads and chat' },
  { src: '/landing/editor/screenshot-code.webp', alt: 'T3 Code screenshot: code view' },
];
const REPLIES: { kind: 'step' | 'text'; text: string }[] = [
  { kind: 'step', text: 'Read 2 screenshots' }, { kind: 'text', text: 'Breaking each screen into parts. 🫡' },
  { kind: 'step', text: 'Built 14 clips' }, { kind: 'step', text: 'Matched colors and type' }, { kind: 'step', text: 'Timed cuts to the music' },
  { kind: 'text', text: 'Your launch film is on the timeline.' },
];

// Screenshots of Revline working inside each app. Until they exist (src null) the panel shows a quiet stand-in.
// Wanted: public/landing/agents/claude.webp and public/landing/agents/chatgpt.webp, 16:9, about 2560x1440.
const AGENT_SHOTS = {
  claude: { name: 'Claude', Logo: ClaudeLogo, src: null as string | null, prompt: 'Turn these screenshots into a 30 second launch film.' },
  chatgpt: { name: 'ChatGPT', Logo: OpenAILogo, src: null as string | null, prompt: 'Cut the pauses and add captions to my podcast clip.' },
};

type View = 'revline' | keyof typeof AGENT_SHOTS;
const VIEWS: { id: View; label: string }[] = [{ id: 'revline', label: 'Revline' }, { id: 'claude', label: 'Claude' }, { id: 'chatgpt', label: 'ChatGPT' }];

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const percent = (seconds: number) => `${(seconds / FILM_SECONDS) * 100}%`;

// A fixed, music-like waveform for the soundtrack clip.
function waveform(bars: number) {
  let seed = 7, path = '';
  for (let index = 0; index < bars; index++) {
    seed = (seed * 9301 + 49297) % 233280;
    const beat = Math.abs(Math.sin(index / 3.1)) * 0.5 + 0.25, height = Math.max(0.12, Math.min(1, beat * (0.55 + (seed / 233280) * 0.7)));
    // Rounded so the server and browser render the same path.
    path += `M${index + 0.5} ${(10 - height * 9).toFixed(2)}V${(10 + height * 9).toFixed(2)}`;
  }
  return path;
}

function Chat() {
  const root = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setShown(true); observer.disconnect(); } }, { threshold: 0.3 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <aside ref={root} className="landing-editor-chat" data-shown={shown || undefined} aria-label="Conversation">
    <div className="landing-editor-chat-head">Launch film from screenshots</div>
    <div className="landing-editor-messages">
      <div className="landing-editor-user" style={{ '--line': 0 } as CSSProperties}>
        <div className="landing-editor-shots">{SCREENSHOTS.map(shot => <img key={shot.src} src={shot.src} alt={shot.alt} width={480} height={300} loading="lazy" decoding="async" />)}</div>
        <p>Make these a launch film</p>
      </div>
      {REPLIES.map((reply, index) => reply.kind === 'step'
        ? <p key={index} className="landing-editor-step" style={{ '--line': index + 1 } as CSSProperties}><Check size={12} aria-hidden="true" />{reply.text}</p>
        : <p key={index} className="landing-editor-reply" style={{ '--line': index + 1 } as CSSProperties}>{reply.text}</p>)}
    </div>
    <div className="landing-editor-composer" aria-hidden="true">
      <span>What would you change next?</span>
      <div><Plus size={14} /><i><ArrowUp size={13} /></i></div>
    </div>
  </aside>;
}

/** The editor timeline around the film: clips and beat markers, a playhead on the video's own time, and click to seek. */
function Timeline({ video, active }: { video: React.RefObject<HTMLVideoElement | null>; active: boolean }) {
  const playhead = useRef<HTMLDivElement>(null), time = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false), [muted, setMuted] = useState(true);
  const wave = useMemo(() => waveform(240), []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    let frame = 0;
    const paint = () => {
      const now = element.currentTime;
      playhead.current?.style.setProperty('left', percent(Math.min(now, FILM_SECONDS)));
      if (time.current) time.current.textContent = clock(now);
      setCurrent(CLIPS.findLastIndex(clip => clip.at <= now + 0.01));
      if (!element.paused) frame = requestAnimationFrame(paint);
    };
    const sync = () => { setPlaying(!element.paused); setMuted(element.muted); cancelAnimationFrame(frame); paint(); };
    const events = ['play', 'pause', 'seeked', 'volumechange', 'timeupdate'] as const;
    sync();
    events.forEach(name => element.addEventListener(name, sync));
    return () => { cancelAnimationFrame(frame); events.forEach(name => element.removeEventListener(name, sync)); };
  }, [video]);

  function seek(seconds: number) {
    const element = video.current;
    if (!element) return;
    element.currentTime = Math.max(0, Math.min(FILM_SECONDS - 0.05, seconds));
    void element.play().catch(() => {});
  }
  function seekAt(event: React.MouseEvent<HTMLElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    seek(((event.clientX - box.left) / box.width) * FILM_SECONDS);
  }
  function toggle() {
    const element = video.current;
    if (element) { if (element.paused) void element.play().catch(() => {}); else element.pause(); }
  }

  return <div className="landing-editor-timeline" inert={!active}>
    <div className="landing-editor-transport">
      <button type="button" onClick={toggle} aria-label={playing ? 'Pause film' : 'Play film'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
      <span className="landing-editor-time"><span ref={time}>00:00</span><span> / {clock(FILM_SECONDS)}</span></span>
      <button type="button" onClick={() => { if (video.current) video.current.muted = !video.current.muted; }} aria-label={muted ? 'Turn sound on' : 'Mute'}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
    </div>
    <div className="landing-editor-tracks">
      <div className="landing-editor-heads" aria-hidden="true"><span /><span><Clapperboard size={11} />V1</span><span><Music size={11} />A1</span></div>
      <div className="landing-editor-lanes">
        <div className="landing-editor-ruler" onClick={seekAt}>
          {Array.from({ length: 8 }, (_, index) => <span key={index} style={{ left: percent(index * 5) }}>{index * 5}s</span>)}
          {BEATS.map(beat => <button key={beat.at} type="button" className="landing-editor-marker" style={{ left: percent(beat.at) }} data-label={beat.label}
            aria-label={`${beat.label}, ${clock(beat.at)}`} onClick={event => { event.stopPropagation(); seek(beat.at); }}>
            <svg width="9" height="11" viewBox="0 0 9 11" aria-hidden="true"><path d="M1 1h7v6L4.5 10 1 7z" /></svg></button>)}
        </div>
        <div className="landing-editor-lane">
          {CLIPS.map((clip, index) => <button key={clip.at} type="button" className="landing-editor-clip" data-current={index === current || undefined} data-act={clip.at >= T3_FROM ? 't3' : 'revline'}
            style={{ left: percent(clip.at), width: `calc(${percent(clip.end - clip.at)} - 2px)` }} aria-label={`${clip.label}, ${clock(clip.at)}`} onClick={() => seek(clip.at)}>
            <span>{clip.label}</span></button>)}
        </div>
        <div className="landing-editor-lane" onClick={seekAt}>
          <div className="landing-editor-audio"><span>Launch theme.mp3</span><svg viewBox="0 0 240 20" preserveAspectRatio="none" aria-hidden="true"><path d={wave} /></svg></div>
        </div>
        <div ref={playhead} className="landing-editor-playhead" aria-hidden="true"><svg width="11" height="14" viewBox="0 0 11 14"><path d="M1 1h9v8l-4.5 4L1 9z" /></svg></div>
      </div>
    </div>
  </div>;
}

/** Revline's editor around the launch film: the chat that made it, the preview playing it, and its timeline. */
function EditorReplica({ video, active }: { video: React.RefObject<HTMLVideoElement | null>; active: boolean }) {
  return <div className="landing-editor" inert={!active}>
    <header className="landing-editor-bar">
      <Brand markOnly />
      <span className="landing-editor-title">Blueprint launch</span>
      <span className="landing-editor-actions" aria-hidden="true"><span>Share</span><b>Export</b></span>
    </header>
    <div className="landing-editor-body">
      <Chat />
      <div className="landing-editor-main">
        <div className="landing-editor-preview">
          <video ref={video} className="landing-editor-film" src={FILM_SRC} poster={FILM_POSTER} muted loop playsInline preload="metadata" aria-label="T3 Code's launch film, made in Revline from screenshots" />
          <div className="landing-editor-meta"><span>Blueprint launch</span><span>1920 × 1080</span></div>
        </div>
        <Timeline video={video} active={active} />
      </div>
    </div>
  </div>;
}

function AgentShot({ id, active }: { id: keyof typeof AGENT_SHOTS; active: boolean }) {
  const { name, Logo, src, prompt } = AGENT_SHOTS[id];
  return <div className="landing-demo-agent" inert={!active}>
    {src ? <img className="landing-demo-shot" src={src} alt={`Revline editing a video inside ${name}`} loading="lazy" decoding="async" />
      : <div className="landing-demo-standin">
        <Logo width={28} height={28} aria-hidden="true" />
        <p className="landing-demo-standin-prompt">{prompt}</p>
        <p className="landing-demo-standin-note">Revline edits the video while you talk to {name}.</p>
      </div>}
    <div className="landing-demo-caption">
      <span>Revline inside {name}</span>
      <LandingInstallAgents variant="neutral" size="sm" initial={id} label={`Install on ${name}`} />
    </div>
  </div>;
}

/** Hero demo: the launch film being made in Revline's editor, and Revline seen from inside Claude and ChatGPT. */
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
      <div className="landing-demo-stage">
        <div className="landing-demo-panel" data-active={view === 'revline' || undefined}><EditorReplica video={video} active={view === 'revline'} /></div>
        {(Object.keys(AGENT_SHOTS) as (keyof typeof AGENT_SHOTS)[]).map(id => <div key={id} className="landing-demo-panel" data-active={view === id || undefined}><AgentShot id={id} active={view === id} /></div>)}
      </div>
    </div>
    <div className="landing-demo-switch" role="tablist" aria-label="Where Revline runs" style={{ '--switch-index': index } as CSSProperties}>
      <span className="landing-demo-switch-pill" aria-hidden="true" />
      {VIEWS.map(item => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => pick(item.id)}>{item.label}</button>)}
    </div>
  </div>;
}
