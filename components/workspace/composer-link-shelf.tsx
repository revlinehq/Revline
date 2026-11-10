'use client';
import { useEffect, useId, useRef } from 'react';
import { Link2, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVideoLinkImport } from '@/components/editor/video-link-import';
import { looksLikeLink } from '@/lib/editor/video-link';

/** One-row link import for the composer's bottom shelf (`EditComposer` `footer`). */
export function ComposerLinkShelf({ open, prefill = '', focusKey = 0, disabled = false, onImport, onClose }: {
  open: boolean; prefill?: string;
  /** Changes when the shelf is asked for again while already open, to put focus back in the field. */
  focusKey?: number;
  disabled?: boolean; onImport: (url: string) => Promise<void>; onClose: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const { url, busy, error, submit, change } = useVideoLinkImport(onImport, disabled || !open);
  // Each opening starts from the pasted link or an empty field, so a closed shelf never keeps old text.
  useEffect(() => { if (open) change(prefill); }, [open, prefill]);
  // Also after a failed import, when the field is enabled again.
  useEffect(() => { if (open && !busy) input.current?.focus({ preventScroll: true }); }, [open, focusKey, busy]);
  const locked = disabled || busy;
  return <div className="composer-link-shelf" role="group" aria-label="Paste a link" aria-busy={busy} onKeyDown={event => {
    if (event.key !== 'Escape' || busy) return;
    event.preventDefault(); event.stopPropagation(); onClose();
  }}>
    <div className="composer-link-row">
      <Link2 className="composer-link-icon" aria-hidden="true"/>
      {/* The shelf sits inside the composer's form: Enter is handled here instead of sending the prompt, and the
          field is plain text so the browser's URL validation cannot block the prompt's send button. */}
      <Input ref={input} type="text" inputMode="url" className="composer-link-input" aria-label="Video link" placeholder="Paste a YouTube or video link" maxLength={2048} autoComplete="off" spellCheck={false} value={url} disabled={locked} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={event => change(event.target.value)} onKeyDown={event => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (url.trim()) void submit();
      }}/>
      <Button type="button" variant="ghost" size="sm" className="composer-link-import" disabled={locked || !looksLikeLink(url)} onClick={() => void submit()}>{busy ? <LoaderCircle className="animate-spin" aria-label="Starting import"/> : 'Import'}</Button>
      <Button type="button" variant="ghost" size="icon-xs" className="composer-link-close" aria-label="Close link import" disabled={busy} onClick={onClose}><X/></Button>
    </div>
    {error && <p id={`${id}-error`} className="composer-link-error" role="alert">{error}</p>}
  </div>;
}
