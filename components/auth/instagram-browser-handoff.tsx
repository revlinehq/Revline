'use client';

import { useState } from 'react';
import { ArrowUpRight, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthFrame } from './auth-frame';

export function InstagramBrowserHandoff({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const destination = new URL(url);
  const intent = `intent://${destination.host}${destination.pathname}${destination.search}#Intent;scheme=${destination.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;

  async function copyLink() {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { document.querySelector<HTMLInputElement>('#auth-browser-url')?.select(); }
  }

  return <AuthFrame><div className="auth-form auth-browser-handoff">
    <header className="auth-header"><h1>Continue in Chrome.</h1><p>Instagram’s browser can prevent sign-in from loading. Open Revline in Chrome to continue with Google or email.</p></header>
    <Button asChild className="auth-google" variant="outline"><a href={intent} data-auth-action="open-browser">Open in Chrome<ArrowUpRight aria-hidden="true" /></a></Button>
    <p className="auth-browser-help">If Chrome doesn’t open, use Instagram’s menu to open this page in your browser, or copy the link below.</p>
    <label className="sr-only" htmlFor="auth-browser-url">Revline sign-in link</label>
    <input id="auth-browser-url" className="auth-browser-url" value={url} readOnly onFocus={event => event.currentTarget.select()} />
    <Button className="auth-browser-copy" variant="outline" onClick={() => void copyLink()}><Copy aria-hidden="true" />{copied ? 'Link copied' : 'Copy link'}</Button>
    <span className="sr-only" role="status">{copied ? 'Sign-in link copied. Paste it into Chrome to continue.' : ''}</span>
  </div></AuthFrame>;
}
