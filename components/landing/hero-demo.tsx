'use client';

import { useEffect, useRef, useState } from 'react';
import './hero-demo.css';

/**
 * The landing hero's live demo: a scripted, looping edit in a drawing of the editor. Everything on
 * screen is derived from one clock, so the loop is deterministic and costs a single re-render per frame.
 * Drawn at 1150×587 and scaled to fit, matching the product screenshot it replaces.
 */
const WIDTH = 1150, HEIGHT = 587, CYCLE = 14_000;
const PROMPT = 'Make it a punchy TikTok cut with captions';
const T = { type: 700, send: 2700, work: 3100, flag: 3400, cut: 4300, cutEnd: 5100, reframe: 5300, reframeEnd: 6000, captions: 6200, captionsEnd: 7600, done: 8000, playEnd: 12_800, fade: 13_400 };
const STEPS = [
  { at: T.flag, done: T.cutEnd, label: 'Removed 38 pauses and a retake' },
  { at: T.reframe, done: T.reframeEnd, label: 'Reframed to 9:16, face centered' },
  { at: T.captions, done: T.captionsEnd, label: 'Added captions' },
  { at: T.captionsEnd, done: T.done, label: 'Trimmed to 0:42' },
];
// Raw take in timeline units: [width, keep]. Cut pieces are the pauses and the retake.
const SEGMENTS: [number, boolean][] = [[8, true], [3, false], [10, true], [4, false], [9, true], [2, false], [12, true], [5, false], [8, true], [3, false], [11, true], [4, false], [9, true], [3, false], [9, true]];
const CAPTIONS = ['when the code', 'finally compiles', 'and you run it', 'one more time', 'and it breaks again', 'me at 3am:', '"it worked yesterday"', 'pushing to prod anyway'];
const KEPT = SEGMENTS.filter(([, keep]) => keep).reduce((sum, [width]) => sum + width, 0);
const TRACK = 640; // px for 100 units
const BARS = Array.from({ length: 200 }, (_, index) => .25 + .75 * Math.abs(Math.sin(index * 1.7) * Math.cos(index * .37)));

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const progress = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
const ease = (value: number) => 1 - Math.pow(1 - value, 3);

function useClock(enabled: boolean) {
  const [t, setT] = useState(enabled ? 0 : T.done + 1500);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0, start = 0;
    const tick = (now: number) => { start ||= now; setT((now - start) % CYCLE); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [enabled]);
  return t;
}

export function HeroDemo() {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [motion, setMotion] = useState(true);
  useEffect(() => {
    setMotion(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const element = frame.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const t = useClock(motion);
  return <div ref={frame} className="hero-demo" style={{ aspectRatio: `${WIDTH}/${HEIGHT}` }} role="img" aria-label="Revline editing a video from one prompt: cutting pauses, reframing to vertical and adding captions">
    <div className="hero-demo-stage" style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})`, opacity: 1 - progress(t, T.fade, CYCLE) }} aria-hidden="true">
      <Editor t={t} />
    </div>
  </div>;
}

function Editor({ t }: { t: number }) {
  const working = t >= T.send && t < T.done, done = t >= T.done;
  const typed = PROMPT.slice(0, Math.round(PROMPT.length * progress(t, T.type, T.send - 300)));
  const flagged = t >= T.flag, cut = ease(progress(t, T.cut, T.cutEnd));
  const reframe = ease(progress(t, T.reframe, T.reframeEnd));
  const play = progress(t, T.done + 300, T.playEnd);
  // Where each kept segment and caption sits once pauses close up.
  let cursor = 0;
  const layout = SEGMENTS.map(([width, keep]) => { const span = keep ? width : width * (1 - cut); const left = cursor; cursor += span; return { width, keep, left, span }; });
  const captions = layout.filter(segment => segment.keep).map((segment, index) => ({ ...segment, text: CAPTIONS[index] ?? '', shown: progress(t, T.captions + index * 160, T.captions + index * 160 + 220) }));
  const playhead = done ? play * KEPT : 0;
  const current = done ? captions.find(caption => playhead >= caption.left && playhead < caption.left + caption.span) : undefined;
  const seconds = done ? 42 * play : 0;
  return <>
    <header className="hd-top">
      <span className="hd-logo"><i />revline</span><span className="hd-project">Video-38119</span>
      <span className="hd-spacer" /><span className="hd-share">Share</span><span className="hd-export">Export</span><span className="hd-avatar" />
    </header>
    <aside className="hd-chat">
      <div className={`hd-tab${working ? ' is-working' : ''}${done && t < T.done + 2000 ? ' is-done' : ''}`}>{working ? 'Revline is working…' : 'Punchier cut for TikTok'}</div>
      <div className="hd-messages">
        {t >= T.send && <div className="hd-user">{PROMPT}</div>}
        {t >= T.work && <ul className="hd-steps">
          {STEPS.map(step => t >= step.at && <li key={step.label} className={t >= step.done ? 'is-done' : ''}><span className="hd-step-icon" />{step.label}</li>)}
        </ul>}
        {done && <div className="hd-reply">Done. 4:56 of footage is now a 0:42 vertical cut with captions.</div>}
      </div>
      <div className={`hd-composer${t >= T.send - 300 && t < T.send ? ' is-sending' : ''}`}>
        <span className={typed && t < T.send ? '' : 'hd-placeholder'}>{t < T.send && typed ? typed : 'What would you change next?'}{t >= T.type && t < T.send && <i className="hd-caret" />}</span>
        <span className="hd-send" />
      </div>
    </aside>
    <section className="hd-preview">
      <span className="hd-ratio">{reframe > .5 ? '9:16' : '16:9'}</span>
      <div className="hd-canvas" style={{ width: 470 - (470 - 148) * reframe }}>
        <div className="hd-footage" style={{ transform: `scale(${1 + .04 * play})` }} />
        {current && <span className="hd-caption" key={current.text}>{current.text}</span>}
      </div>
    </section>
    <section className="hd-timeline">
      <div className="hd-transport"><span className="hd-play" /><span className="hd-time">{`00:${String(Math.floor(seconds)).padStart(2, '0')}`}<em> / {done || cut === 1 ? '00:42' : '04:56'}</em></span></div>
      <div className="hd-lanes">
        <span className="hd-label">V2</span>
        <div className="hd-lane">{captions.map(caption => caption.shown > 0 && <span key={caption.text} className="hd-chip" style={{ left: caption.left / 100 * TRACK, width: caption.span / 100 * TRACK - 3, opacity: caption.shown, transform: `translateY(${(1 - caption.shown) * 6}px)` }}>{caption.text}</span>)}</div>
        <span className="hd-label">V1</span>
        <div className="hd-lane">{layout.map((segment, index) => segment.span > .05 && <span key={index} className={`hd-clip${!segment.keep && flagged ? ' is-cut' : ''}`} style={{ left: segment.left / 100 * TRACK, width: segment.span / 100 * TRACK - (segment.keep ? 2 : 0) }} />)}</div>
        <span className="hd-label">A1</span>
        <div className="hd-lane">{layout.map((segment, index) => segment.span > .05 && <span key={index} className={`hd-audio${!segment.keep && flagged ? ' is-cut' : ''}`} style={{ left: segment.left / 100 * TRACK, width: segment.span / 100 * TRACK - (segment.keep ? 2 : 0) }}>
          {BARS.slice(index * 13, index * 13 + Math.max(1, Math.round(segment.width * 1.3))).map((height, bar) => <i key={bar} style={{ height: `${(segment.keep ? height : height * .2) * 100}%` }} />)}
        </span>)}</div>
        <span className="hd-playhead" style={{ left: 40 + playhead / 100 * TRACK }} />
      </div>
    </section>
  </>;
}
