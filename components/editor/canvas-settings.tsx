'use client';

import { PanelRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AspectRatioControl } from './aspect-ratio-control';
import type { AspectRatio } from '@/lib/editor/types';

export function CanvasSettings({ aspectRatio, onAspectRatioChange, inspectorOpen, onToggleInspector, children }: { aspectRatio: AspectRatio; onAspectRatioChange: (value: AspectRatio) => void; inspectorOpen: boolean; onToggleInspector: () => void; children?: React.ReactNode }) {
  return <div className="canvas-toolbar">
    <AspectRatioControl value={aspectRatio} onChange={onAspectRatioChange} />
    {children}
    <Button variant="ghost" className="canvas-inspector-toggle" aria-label={inspectorOpen ? 'Hide editing panel' : 'Show editing panel'} aria-pressed={inspectorOpen} onClick={onToggleInspector}><PanelRight size={15} strokeWidth={1.5}/></Button>
  </div>;
}
