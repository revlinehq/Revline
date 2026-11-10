'use client';

import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The preview bar: the chat toggle, the timeline tabs, then the aspect ratio chip. The editing panel opens from the tool rail and closes from its own header. */
export function CanvasSettings({ onShowChat, onHideChat, tabs, children }: { onShowChat?: () => void; onHideChat?: () => void; /** The timeline tab switcher; with it, the bar's other controls move to the right end. */ tabs?: React.ReactNode; children?: React.ReactNode }) {
  if (!onShowChat && !onHideChat && !tabs && !children) return null;
  return <div className="canvas-toolbar">
    {onShowChat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Show chat" onClick={onShowChat}><PanelLeft size={15} strokeWidth={1.5}/></Button>}
    {onHideChat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Hide chat" onClick={onHideChat}><PanelLeftClose size={15} strokeWidth={1.5}/></Button>}
    {tabs}
    {tabs && children ? <div className="canvas-toolbar-end">{children}</div> : children}
  </div>;
}
