'use client';

import { PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PanelToggle = { open: boolean; onToggle: () => void };

/** The preview bar: the media panel's toggle at the left corner, the aspect ratio chip, and the chat's toggle at the right corner. */
export function CanvasSettings({ media, chat, children }: { media?: PanelToggle; chat?: PanelToggle; children?: React.ReactNode }) {
  if (!media && !chat && !children) return null;
  const mediaLabel = media?.open ? 'Hide media' : 'Show media', chatLabel = chat?.open ? 'Hide chat' : 'Show chat';
  return <div className="canvas-toolbar">
    {media && <Button variant="ghost" size="icon-sm" className="canvas-media-toggle" aria-label={mediaLabel} aria-expanded={media.open} title={mediaLabel} onClick={media.onToggle}>{media.open ? <PanelLeftClose size={15} strokeWidth={1.5}/> : <PanelLeft size={15} strokeWidth={1.5}/>}</Button>}
    {children}
    {chat && <Button variant="ghost" size="icon-sm" className="canvas-chat-toggle ml-auto" aria-label={chatLabel} aria-expanded={chat.open} title={chatLabel} onClick={chat.onToggle}>{chat.open ? <PanelRightClose size={15} strokeWidth={1.5}/> : <PanelRight size={15} strokeWidth={1.5}/>}</Button>}
  </div>;
}
