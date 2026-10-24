'use client';

import { PanelRightOpen, Type } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EffectIcon, type EffectIconName } from './effect-icon';
import type { LibraryShortcutCategory } from './effect-library';
import './floating-tools-rail.css';

const shortcuts: { category: LibraryShortcutCategory; label: string; icon?: EffectIconName }[] = [
  { category: 'motion', label: 'Motion', icon: 'punch' },
  { category: 'color', label: 'Color', icon: 'colorGrade' },
  { category: 'texture', label: 'Texture', icon: 'filmOverlay' },
  { category: 'text', label: 'Text' },
];

export function FloatingToolsRail({ category, onCategory, onExpand }: { category: LibraryShortcutCategory; onCategory: (category: LibraryShortcutCategory) => void; onExpand: () => void }) {
  return <TooltipProvider delayDuration={250}><nav className="floating-tools-rail" aria-label="Compact editing tools"><div className="floating-tools-rail-list">
    <Tooltip><TooltipTrigger asChild><button type="button" aria-label="Expand editing panel" onClick={onExpand}><PanelRightOpen size={18} strokeWidth={1.5}/></button></TooltipTrigger><TooltipContent side="left" sideOffset={12} className="floating-tools-tooltip">Expand editing panel</TooltipContent></Tooltip>
    <span className="floating-tools-rail-divider" aria-hidden="true"/>
    {shortcuts.map(shortcut => <Tooltip key={shortcut.category}><TooltipTrigger asChild><button type="button" aria-label={`Open ${shortcut.label} tools`} aria-pressed={category === shortcut.category} onClick={() => onCategory(shortcut.category)}>{shortcut.icon ? <EffectIcon name={shortcut.icon} size={20}/> : <Type size={20} strokeWidth={1.5}/>}</button></TooltipTrigger><TooltipContent side="left" sideOffset={12} className="floating-tools-tooltip">{shortcut.label}</TooltipContent></Tooltip>)}
  </div></nav></TooltipProvider>;
}
