'use client';

import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CanvasSettings({ inspectorOpen, onToggleInspector, children }: { inspectorOpen: boolean; onToggleInspector: () => void; children?: React.ReactNode }) {
  return <div className="canvas-toolbar">
    {children}
    <Button variant="ghost" className="canvas-inspector-toggle" aria-label={inspectorOpen ? 'Hide editing panel' : 'Show editing panel'} aria-pressed={inspectorOpen} onClick={onToggleInspector}><PanelRight size={15} strokeWidth={1.5}/></Button>
  </div>;
}
