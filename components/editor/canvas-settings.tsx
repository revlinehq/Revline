'use client';

import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** The preview bar: the aspect ratio chip, plus a way back to a collapsed chat. The editing panel opens from the tool rail and closes from its own header. */
export function CanvasSettings({ onShowChat, onHideChat, children }: { onShowChat?: () => void; onHideChat?: () => void; children?: React.ReactNode }) {
  if (!onShowChat && !onHideChat && !children) return null;
  return <div className="canvas-toolbar">
    {onShowChat && <Button variant="ghost" className="canvas-chat-toggle" onClick={onShowChat}><PanelLeft size={15} strokeWidth={1.5}/>Show chat</Button>}
    {onHideChat && <Button variant="ghost" className="canvas-chat-toggle" onClick={onHideChat}><PanelLeftClose size={15} strokeWidth={1.5}/>Hide chat</Button>}
    {children}
  </div>;
}
