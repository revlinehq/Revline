'use client';

import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The preview bar: the aspect ratio chip, plus a way back to a collapsed chat. The editing panel opens from the tool rail and closes from its own header. */
export function CanvasSettings({ onShowChat, onHideChat, children }: { onShowChat?: () => void; onHideChat?: () => void; children?: React.ReactNode }) {
  if (!onShowChat && !onHideChat && !children) return null;
  return <div className="canvas-toolbar">
    {onShowChat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Show chat" onClick={onShowChat}><PanelLeft size={15} strokeWidth={1.5}/></Button>}
    {onHideChat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle" aria-label="Hide chat" onClick={onHideChat}><PanelLeftClose size={15} strokeWidth={1.5}/></Button>}
    {children}
  </div>;
}
