'use client';

import { PanelRightOpen } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import './floating-tools-rail.css';

/** Shown while the editing panel is collapsed: one button brings it back. */
export function FloatingToolsRail({ onExpand }: { onExpand: () => void }) {
  return <TooltipProvider delayDuration={250}><nav className="floating-tools-rail" aria-label="Compact editing tools"><div className="floating-tools-rail-list">
    <Tooltip><TooltipTrigger asChild><button type="button" aria-label="Expand editing panel" onClick={onExpand}><PanelRightOpen size={18} strokeWidth={1.5}/></button></TooltipTrigger><TooltipContent side="left" sideOffset={12} className="floating-tools-tooltip">Expand editing panel</TooltipContent></Tooltip>
  </div></nav></TooltipProvider>;
}
