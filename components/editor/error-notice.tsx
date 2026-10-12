import { useEffect } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { isLegacyTimelineGestureMessage } from '@/lib/editor/timeline-edit-errors';

export function EditorErrorNotice({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const obsolete = isLegacyTimelineGestureMessage(message);
  useEffect(() => {
    if (!message) return;
    if (obsolete) { onDismiss(); return; }
    const timer = window.setTimeout(onDismiss, 8000);
    return () => window.clearTimeout(timer);
  }, [message, obsolete, onDismiss]);

  if (!message || obsolete) return null;
  const text = message.includes('[CONVEX') ? 'This action couldn’t finish. Please try again.' : message;
  return <div className="editor-error-notice" role="alert">
    <CircleAlert size={16} aria-hidden="true" />
    <span>{text}</span>
    <button type="button" aria-label="Dismiss error" onClick={onDismiss}><X size={14} /></button>
  </div>;
}
