'use client';
import { NEW_PROJECT_PATH } from '@/lib/workspace-routes';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowUp, Paperclip } from 'lucide-react';
import { LandingButton, LandingHeading, LandingSection } from './ui';

// Read by the new-project page; Revline sends it as the first request once the footage is imported.
const BRIEF_KEY = 'revline:next-brief';
const suggestions = ['Cut this podcast into three 30-second shorts', 'Tighten it to 60 seconds with captions', 'Make a punchy product demo for TikTok'];
const backdrop = ['podcast', 'code-screen', 'vlog', 'talking-head', 'classroom', 'beauty'];

export function LandingFinalCta() {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const [prompt, setPrompt] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);

  function start(event?: React.FormEvent) {
    event?.preventDefault();
    const brief = prompt.trim();
    try { if (brief) sessionStorage.setItem(BRIEF_KEY, brief); else sessionStorage.removeItem(BRIEF_KEY); } catch { /* The visitor can still describe the edit in the editor. */ }
    router.push(isSignedIn ? NEW_PROJECT_PATH : '/sign-in');
  }
  function suggest(text: string) {
    setPrompt(text);
    input.current?.focus();
  }

  return <LandingSection className="landing-final" headingId="landing-final-heading">
    <div className="landing-final-card">
      <div className="landing-final-backdrop" aria-hidden="true">{backdrop.map(image => <img key={image} src={`/landing/${image}.webp`} alt="" loading="lazy" decoding="async" />)}</div>
      <LandingHeading id="landing-final-heading" align="center" tone="inverse" size="lg" title={<>Your next video is<br />one prompt away.</>} description="Describe the edit, add your footage, and Revline does the rest." />
      <form className="landing-composer" onSubmit={start}>
        <label className="sr-only" htmlFor="landing-prompt">Describe your edit</label>
        <textarea ref={input} id="landing-prompt" rows={2} placeholder="Describe your edit…" value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) start(event); }} />
        <div className="landing-composer-bar">
          <span><Paperclip size={16} aria-hidden="true" />Add footage next</span>
          <LandingButton type="submit" variant="brand" size="sm">Start editing<ArrowUp size={15} aria-hidden="true" /></LandingButton>
        </div>
      </form>
      <div className="landing-suggestions" aria-label="Example prompts">{suggestions.map(text => <LandingButton key={text} variant="inverse-outline" size="sm" onClick={() => suggest(text)}>{text}</LandingButton>)}</div>
      <small>3 days free · Cancel anytime</small>
    </div>
  </LandingSection>;
}
