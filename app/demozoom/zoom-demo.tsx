'use client';

import { useEffect, useRef, useState } from 'react';
import { zoomEase } from '@/lib/editor/smooth-zoom';

// These spring studies are isolated from the editor's supported easing schema.
const STYLES = [
  { id: 'current', name: 'Current ease-out', tag: 'In our editor', description: 'Quick start, gentle braking. Our existing cubic curve.', color: '#aea8ff' },
  { id: 'exponential', name: 'Fast ease-out', tag: 'Demo only', description: 'More punch up front, with a longer, softer landing.', color: '#8cc8ec' },
  { id: 'focused', name: 'Focused spring', tag: 'In our editor', description: 'A fast pull toward the target. Settles without bouncing.', color: '#a3d5bd' },
  { id: 'smooth', name: 'Soft spring', tag: 'Demo only', description: 'A little momentum, a tiny overshoot, then a smooth settle.', color: '#e5bc90' },
] as const;
type Style = typeof STYLES[number];

function ease(id: Style['id'], p: number) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (id === 'current') return zoomEase(p, 'ease-out');
  if (id === 'exponential') return (1 - 2 ** (-10 * p)) / (1 - 2 ** -10);
  if (id === 'focused') return zoomEase(p, 'focused-spring');
  // Analytical damped spring, sampled into compositor transform keyframes.
  const damping = .78, frequency = 11, damped = frequency * Math.sqrt(1 - damping ** 2);
  const settle = (t: number) => 1 - Math.exp(-damping * frequency * t) * (Math.cos(damped * t) + damping * frequency / damped * Math.sin(damped * t));
  return settle(p) / settle(1);
}

function DemoScreen() {
  return <svg viewBox="0 0 1000 625" aria-hidden="true" className="zoom-demo-screen">
    <rect width="1000" height="625" fill="#f4f4f6" />
    <rect width="1000" height="36" fill="#e6e6ea" />
    {[24, 43, 62].map((x, index) => <circle key={x} cx={x} cy="18" r="5" fill={['#d89090', '#d6ba80', '#8cbda0'][index]} />)}
    <rect x="360" y="9" width="280" height="18" rx="5" fill="#f4f4f6" />
    <text x="500" y="22" textAnchor="middle" fill="#74747e" fontSize="11">revline · your workspace</text>
    <rect y="36" width="190" height="589" fill="#efeff2" />
    <text x="28" y="87" fill="#30303c" fontSize="25" fontWeight="700">Revline</text>
    {['Workspace', 'Your projects', 'Media library'].map((label, index) => <g key={label}>
      {index === 0 && <rect x="14" y="117" width="161" height="40" rx="7" fill="#e0ddef" />}
      <rect x="29" y={131 + index * 51} width="13" height="13" rx="3" fill={index === 0 ? '#8275d3' : '#bdbdc8'} />
      <text x="54" y={142 + index * 51} fontSize="14" fill="#666675">{label}</text>
    </g>)}
    <text x="242" y="112" fontSize="28" fontWeight="600" fill="#24242f">Your next edit starts here.</text>
    <text x="242" y="144" fontSize="15" fill="#888894">A little footage. A few words. Your next video.</text>
    <rect x="242" y="190" width="702" height="250" rx="14" fill="white" stroke="#e2e2e9" />
    <rect x="565" y="237" width="170" height="135" rx="11" fill="#f3f0ff" stroke="#cfc5f5" strokeDasharray="5 5" />
    <rect x="628" y="258" width="44" height="44" rx="12" fill="#7161ce" />
    <path d="M650 270v20m-10-10h20" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    <text x="650" y="326" textAnchor="middle" fontSize="17" fill="#34313f" fontWeight="600">Upload footage</text>
    <text x="650" y="348" textAnchor="middle" fontSize="12" fill="#8b859b">Drop a clip to get started</text>
    <path d="m706 352 3 29 7-9 11 4-21-24Z" fill="#262430" stroke="white" strokeWidth="2" />
    <text x="242" y="493" fontSize="16" fill="#555562" fontWeight="600">Recent projects</text>
    {[242, 481, 720].map((x, index) => <g key={x}>
      <rect x={x} y="513" width="224" height="88" rx="8" fill={['#d7dee4', '#e3dad6', '#d9d6e6'][index]} />
      <rect x={x + 15} y="533" width="65" height="7" rx="3" fill="#ffffffb0" />
      <rect x={x + 15} y="549" width="105" height="5" rx="2" fill="#ffffff80" />
    </g>)}
  </svg>;
}

function ZoomCard({ style, duration, amount, slow, loop, replay }: { style: Style; duration: number; amount: number; slow: boolean; loop: boolean; replay: number }) {
  const camera = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLDivElement>(null);
  const [localReplay, setLocalReplay] = useState(0);
  useEffect(() => {
    if (!camera.current || !progress.current) return;
    // Respect reduced motion on entry; explicit Replay still lets the user inspect it.
    if (replay === 0 && localReplay === 0 && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lead = 250, hold = 950, rest = 450, total = lead + duration * 2 + hold + rest;
    const transform = (value: number) => {
      const scale = 1 + (amount - 1) * value;
      // The upload target is at 65% across / 49% down in the source frame.
      return `translate(${(.5 - .65) * (scale - 1) * 100}%, ${(.5 - .49) * (scale - 1) * 100}%) scale(${scale})`;
    };
    const frames: Keyframe[] = [{ offset: 0, transform: transform(0) }];
    for (let index = 0; index <= 100; index++) frames.push({ offset: (lead + duration * index / 100) / total, transform: transform(ease(style.id, index / 100)) });
    for (let index = 0; index <= 100; index++) frames.push({ offset: (lead + duration + hold + duration * index / 100) / total, transform: transform(1 - ease(style.id, index / 100)) });
    frames.push({ offset: 1, transform: transform(0) });
    const options: KeyframeAnimationOptions = { duration: total * (slow ? 2 : 1), iterations: loop ? Infinity : 1, fill: 'both', easing: 'linear' };
    const animation = camera.current.animate(frames, options);
    const bar = progress.current.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], options);
    const visibility = () => {
      if (document.hidden) { animation.pause(); bar.pause(); }
      else if (animation.playState === 'paused') { animation.play(); bar.play(); }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { animation.cancel(); bar.cancel(); document.removeEventListener('visibilitychange', visibility); };
  }, [style.id, duration, amount, slow, loop, replay, localReplay]);
  const curve = Array.from({ length: 81 }, (_, index) => `${(8 + index * 1.3).toFixed(3)},${(45 - ease(style.id, index / 80) * 36).toFixed(3)}`).join(' ');
  return <article className="zoom-demo-card" style={{ '--zoom-accent': style.color } as React.CSSProperties}>
    <header className="zoom-demo-card-heading"><div><h2>{style.name}</h2><p>{style.description}</p></div><span className="zoom-demo-tag">{style.tag}</span></header>
    <div className="zoom-demo-viewport"><div className="zoom-demo-camera" ref={camera}><DemoScreen /></div><span className="zoom-demo-scale">{amount.toFixed(1)}× zoom</span></div>
    <div className="zoom-demo-progress"><div ref={progress} /></div>
    <footer className="zoom-demo-card-footer"><svg viewBox="0 0 120 52" aria-label={`${style.name} motion curve`} role="img"><path d="M8 8V45H112" fill="none" stroke="#34343e" /><polyline points={curve} fill="none" stroke={style.color} strokeWidth="2" /></svg><span>Zoom in <i>→</i> Hold <i>→</i> Return</span><button onClick={() => setLocalReplay(value => value + 1)} aria-label={`Replay ${style.name}`}>↻ <span>Replay</span></button></footer>
  </article>;
}

export function ZoomDemo() {
  const [duration, setDuration] = useState(700);
  const [amount, setAmount] = useState(2.2);
  const [slow, setSlow] = useState(false);
  const [loop, setLoop] = useState(true);
  const [replay, setReplay] = useState(0);
  return <main className="zoom-demo">
    <div className="zoom-demo-inner">
      <nav className="zoom-demo-nav"><a href="/">Revline<span> / Motion studies</span></a><span>01 / Zoom</span></nav>
      <header className="zoom-demo-intro"><div><p className="zoom-demo-eyebrow">A FEEL FOR MOTION</p><h1>Same zoom.<br /><span>Different feeling.</span></h1><p>Compare a quick brake, a soft landing, and a little spring.<br className="zoom-demo-desktop-break" /> Every preview uses the same target and timing.</p></div><button className="zoom-demo-replay" onClick={() => setReplay(value => value + 1)}>↻ Replay all</button></header>
      <section className="zoom-demo-controls" aria-label="Zoom comparison controls">
        <label className="zoom-demo-slider"><span>Transition <output>{duration} ms</output></span><input aria-label="Transition duration" type="range" min="300" max="1400" step="50" value={duration} onChange={event => setDuration(Number(event.target.value))} /></label>
        <label className="zoom-demo-slider"><span>Zoom amount <output>{amount.toFixed(1)}×</output></span><input aria-label="Zoom amount" type="range" min="1.4" max="3" step=".1" value={amount} onChange={event => setAmount(Number(event.target.value))} /></label>
        <div className="zoom-demo-toggles"><label><input type="checkbox" checked={slow} onChange={event => setSlow(event.target.checked)} />Half speed</label><label><input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />Loop</label></div>
      </section>
      <section className="zoom-demo-grid" aria-label="Zoom styles">{STYLES.map(style => <ZoomCard key={style.id} style={style} duration={duration} amount={amount} slow={slow} loop={loop} replay={replay} />)}</section>
      <p className="zoom-demo-note">Current ease-out and Focused spring are available in the editor. The other curves are demo studies. These aren’t an exact recreation of Screen Studio; playing this page doesn’t change your project.</p>
    </div>
  </main>;
}
