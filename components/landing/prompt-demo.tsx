'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, LoaderCircle, Mic, Paperclip } from 'lucide-react';

const PROMPT = 'Tighten it to 60 seconds, punchier pacing, captions in our brand font.';
const STEPS = ['Cut to 60 seconds', 'Tightened the pacing', 'Added captions in your brand font'];
const TYPE_MS = 42;

type Demo = { typed: number; sent: boolean; pressed: boolean; steps: number; leaving: boolean };
const idle: Demo = { typed: 0, sent: false, pressed: false, steps: 0, leaving: false };
const finished: Demo = { typed: PROMPT.length, sent: false, pressed: false, steps: 0, leaving: false };

/** Loops a typed prompt, its send, and Revline's steps while the card is on screen. Reduced motion shows the typed prompt. */
export function PromptDemo() {
  const root = useRef<HTMLDivElement>(null);
  const [demo, setDemo] = useState<Demo>(finished);

  useEffect(() => {
    const element = root.current;
    if (!element || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, update: (current: Demo) => Demo) => timers.push(setTimeout(() => setDemo(update), ms));
    const play = () => {
      setDemo(idle);
      let time = 500;
      for (let index = 1; index <= PROMPT.length; index++) at(time += TYPE_MS, current => ({ ...current, typed: index }));
      at(time += 450, current => ({ ...current, pressed: true }));
      at(time += 160, current => ({ ...current, pressed: false, sent: true }));
      STEPS.forEach((_, index) => at(time += index ? 750 : 600, current => ({ ...current, steps: index + 1 })));
      at(time += 1100, current => ({ ...current, steps: STEPS.length + 1 }));
      at(time += 2200, current => ({ ...current, leaving: true }));
      timers.push(setTimeout(play, time + 500));
    };
    const stop = () => { timers.forEach(clearTimeout); timers = []; };
    const observer = new IntersectionObserver(([entry]) => { stop(); if (entry.isIntersecting) play(); else setDemo(finished); }, { threshold: 0.35 });
    observer.observe(element);
    return () => { observer.disconnect(); stop(); };
  }, []);

  const typing = !demo.sent && demo.typed < PROMPT.length;
  return <div ref={root} className="landing-prompt-demo" data-sent={demo.sent || undefined} data-leaving={demo.leaving || undefined} aria-hidden="true">
    <div className="landing-prompt-thread">
      <p className="landing-prompt-bubble">{PROMPT}</p>
      <ul className="landing-prompt-steps">{STEPS.map((step, index) => <li key={step} data-state={demo.steps > index + 1 || demo.steps > STEPS.length ? 'done' : demo.steps === index + 1 ? 'working' : 'waiting'}>
        {demo.steps > index + 1 || demo.steps > STEPS.length ? <Check size={14} /> : <LoaderCircle size={14} />}{step}
      </li>)}</ul>
    </div>
    <div className="landing-panel landing-prompt-panel">
      <p>{demo.sent ? <span className="landing-prompt-placeholder">What would you change next?</span> : <>{PROMPT.slice(0, demo.typed)}{typing && <span className="landing-prompt-caret" />}</>}</p>
      <div><span><Paperclip size={16} /><Mic size={16} /></span><span className="landing-prompt-send" data-pressed={demo.pressed || undefined}><ArrowUp size={15} /></span></div>
    </div>
  </div>;
}
