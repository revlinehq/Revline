import { useEffect } from 'react';
import { CircleAlert, Info, X } from 'lucide-react';
import { isLegacyTimelineGestureMessage } from '@/lib/editor/timeline-edit-errors';

/** The editor's small notice in the corner: an error, or with `info` a plain note. It leaves on its own after eight seconds. */
export function EditorErrorNotice({ message, onDismiss, info = false }: { message: string; onDismiss: () => void; info?: boolean }) {
  const obsolete = isLegacyTimelineGestureMessage(message);
  useEffect(() => {
    if (!message) return;
    if (obsolete) { onDismiss(); return; }
    const timer = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(timer);
  }, [message, obsolete, onDismiss]);

  if (!message || obsolete) return null;
  const text = message.includes('[CONVEX') ? 'This action couldn’t finish. Please try again.' : message;
  return <div className="editor-error-notice" role={info ? 'status' : 'alert'}>
    {info ? <Info size={16} aria-hidden="true" /> : <CircleAlert size={16} aria-hidden="true" />}
    <span>{text}</span>
    <button type="button" aria-label={info ? 'Dismiss' : 'Dismiss error'} onClick={onDismiss}><X size={14} /></button>
  </div>;
}
