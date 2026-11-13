'use client';

import { PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The preview bar: the chat toggle, the timeline tabs, the aspect ratio chip, then the media toggle. Both sidebars open and close with the same panel icon button, mirrored. */
export function CanvasSettings({ onShowChat, onHideChat, onShowMedia, onHideMedia, tabs, children }: { onShowChat?: () => void; onHideChat?: () => void; onShowMedia?: () => void; onHideMedia?: () => void; /** The timeline tab switcher; with it, the bar's other controls move to the right end. */ tabs?: React.ReactNode; children?: React.ReactNode }) {
  if (!onShowChat && !onHideChat && !onShowMedia && !onHideMedia && !tabs && !children) return null;
  const media = onShowMedia ? <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Show media" aria-expanded={false} onClick={onShowMedia}><PanelRight size={15} strokeWidth={1.5}/></Button>
    : onHideMedia ? <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Hide media" aria-expanded onClick={onHideMedia}><PanelRightClose size={15} strokeWidth={1.5}/></Button> : null;
  const end = children || media ? <>{children}{media}</> : null;
  return <div className="canvas-toolbar">
    {onShowChat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Show chat" onClick={onShowChat}><PanelLeft size={15} strokeWidth={1.5}/></Button>}
    {onHideChat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Hide chat" onClick={onHideChat}><PanelLeftClose size={15} strokeWidth={1.5}/></Button>}
    {tabs}
    {tabs && end ? <div className="canvas-toolbar-end">{end}</div> : end}
  </div>;
}
