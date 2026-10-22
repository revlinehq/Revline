'use client';

import { PanelLeft, PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CanvasSettings({ inspectorOpen, onToggleInspector, onShowChat, children }: { inspectorOpen: boolean; onToggleInspector: () => void; onShowChat?: () => void; children?: React.ReactNode }) {
  return <div className="canvas-toolbar">
    {onShowChat && <Button variant="ghost" className="canvas-chat-toggle" onClick={onShowChat}><PanelLeft size={15} strokeWidth={1.5}/>Show chat</Button>}
    {children}
    <Button variant="ghost" className="canvas-inspector-toggle" aria-label={inspectorOpen ? 'Hide editing panel' : 'Show editing panel'} aria-pressed={inspectorOpen} onClick={onToggleInspector}><PanelRight size={15} strokeWidth={1.5}/></Button>
  </div>;
}
